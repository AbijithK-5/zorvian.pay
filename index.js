const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const options = {};

// Add body parsers for high-capacity uploads (base64 image strings)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Add CORS middleware to allow cross-origin POST requests from Electron/web client
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type,Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Cache Map for uploaded bill images (in-memory)
const billImagesCache = new Map();

// Cache Map for uploaded bill JSON data (base64 encoded) — used by short URL
const billDataCache = new Map();

// Ratings Store & Persistent Storage
// Rating Concept:
// Stores the total ratings and rating count in a server-side JSON file instead of a database.
// Each new rating updates the JSON file, recalculates the average, and displays the latest
// count and average to all users across the website and connected app.
// Setup dynamic writeable directory (handles Vercel and local Windows environments)
const getTmpDir = () => {
  if (process.env.VERCEL) {
    return '/tmp';
  }
  const localTmp = path.join(__dirname, 'tmp');
  try {
    if (!fs.existsSync(localTmp)) {
      fs.mkdirSync(localTmp, { recursive: true });
    }
    // Test write permission
    const testFile = path.join(localTmp, '.write_test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    return localTmp;
  } catch (e) {
    return '/tmp';
  }
};
const tmpDir = getTmpDir();

const BILLING_APP_URL = process.env.BILLING_APP_URL || 'http://localhost:5002';
const cachedRatingsFilePath = path.join(tmpDir, 'cached_ratings.json');
const pendingRatingsFilePath = path.join(tmpDir, 'pending_ratings.json');
const localCachedRatingsFilePath = path.join(__dirname, 'cached_ratings.json');
const localPendingRatingsFilePath = path.join(__dirname, 'pending_ratings.json');

let cachedRatings = { totalRating: 0, ratingCount: 0, averageRating: 0.0 };

function getCachedRatingsPath() {
  try {
    if (fs.existsSync(localCachedRatingsFilePath)) return localCachedRatingsFilePath;
  } catch (_) {}
  return cachedRatingsFilePath;
}

function getPendingRatingsPath() {
  try {
    if (fs.existsSync(localPendingRatingsFilePath)) return localPendingRatingsFilePath;
  } catch (_) {}
  return pendingRatingsFilePath;
}

function loadCachedRatings() {
  const filePath = getCachedRatingsPath();
  try {
    if (fs.existsSync(filePath)) {
      cachedRatings = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      console.log('[Server] Loaded cached ratings from writeable path:', filePath);
      return;
    }
  } catch (err) {
    console.error('[Server] Failed to load cached ratings from writeable path:', err.message);
  }

  // Fallback to load initial values from committed repository file
  const committedPath = path.join(__dirname, 'tmp', 'cached_ratings.json');
  try {
    if (fs.existsSync(committedPath)) {
      cachedRatings = JSON.parse(fs.readFileSync(committedPath, 'utf8'));
      console.log('[Server] Loaded initial ratings from committed file:', committedPath);
      // Try to seed the writeable path so next loads use it
      try {
        fs.writeFileSync(filePath, JSON.stringify(cachedRatings, null, 2), 'utf8');
      } catch (writeErr) {
        console.warn('[Server] Could not seed writeable path:', writeErr.message);
      }
      return;
    }
  } catch (err) {
    console.error('[Server] Failed to load committed cached ratings:', err.message);
  }

  cachedRatings = { totalRating: 0, ratingCount: 0, averageRating: 0.0 };
}

function saveCachedRatings(data) {
  cachedRatings = data;
  const filePath = getCachedRatingsPath();
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[Server] Failed to write cached ratings to', filePath, 'trying fallback:', err.message);
    const fallbackPath = filePath === cachedRatingsFilePath ? localCachedRatingsFilePath : cachedRatingsFilePath;
    try {
      fs.writeFileSync(fallbackPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (fallbackErr) {
      console.error('[Server] Failed to write cached ratings to fallback:', fallbackErr.message);
    }
  }
}

function loadPendingRatings() {
  const filePath = getPendingRatingsPath();
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (err) {
    console.error('[Server] Failed to load pending ratings from writeable path:', err.message);
  }

  // Fallback to committed repository file
  const committedPath = path.join(__dirname, 'tmp', 'pending_ratings.json');
  try {
    if (fs.existsSync(committedPath)) {
      const queue = JSON.parse(fs.readFileSync(committedPath, 'utf8'));
      // Seed the writeable path
      try {
        fs.writeFileSync(filePath, JSON.stringify(queue, null, 2), 'utf8');
      } catch (writeErr) {}
      return queue;
    }
  } catch (err) {
    console.error('[Server] Failed to load committed pending ratings:', err.message);
  }

  return [];
}

function savePendingRatings(queue) {
  const filePath = getPendingRatingsPath();
  try {
    fs.writeFileSync(filePath, JSON.stringify(queue, null, 2), 'utf8');
  } catch (err) {
    console.error('[Server] Failed to write pending ratings to', filePath, 'trying fallback:', err.message);
    const fallbackPath = filePath === pendingRatingsFilePath ? localPendingRatingsFilePath : pendingRatingsFilePath;
    try {
      fs.writeFileSync(fallbackPath, JSON.stringify(queue, null, 2), 'utf8');
    } catch (fallbackErr) {
      console.error('[Server] Failed to write pending ratings to fallback:', fallbackErr.message);
    }
  }
}

function queueRating(score) {
  const queue = loadPendingRatings();
  queue.push({ score, timestamp: Date.now() });
  savePendingRatings(queue);
  console.log(`[Server] Queued offline rating: ${score} ★. Queue size: ${queue.length}`);
}

let isSyncing = false;

async function syncWithBillingApp() {
  if (isSyncing) return;
  isSyncing = true;
  
  try {
    // 1. Process pending ratings if any
    const pending = loadPendingRatings();
    if (pending.length > 0) {
      console.log(`[Server] Attempting to sync ${pending.length} pending offline ratings to Billing App...`);
      const response = await fetch(`${BILLING_APP_URL}/api/ratings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ratings: pending })
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log(`[Server] Successfully synced pending ratings. Cleared offline queue.`);
        savePendingRatings([]); // clear queue
        saveCachedRatings({
          totalRating: data.totalRating,
          ratingCount: data.ratingCount,
          averageRating: data.averageRating
        });
      } else {
        console.warn('[Server] Billing App rejected pending ratings batch. Status:', response.status);
      }
    }
    
    // 2. Query latest ratings to stay in sync
    const res = await fetch(`${BILLING_APP_URL}/api/ratings`);
    if (res.ok) {
      const data = await res.json();
      saveCachedRatings({
        totalRating: data.totalRating,
        ratingCount: data.ratingCount,
        averageRating: data.averageRating
      });
    }
  } catch (err) {
    console.log('[Server] Billing App is offline. Sync deferred. Error:', err.message);
  } finally {
    isSyncing = false;
  }
}

// Initial cache load
loadCachedRatings();

// Only run background interval if not on Vercel
if (!process.env.VERCEL) {
  // Run initial sync check
  syncWithBillingApp();
  // Periodic check every 30 seconds
  setInterval(syncWithBillingApp, 30000);
}

// Serve temp-uploads for Vercel /tmp directory caching
app.use('/tmp-uploads', express.static(tmpDir));

app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Fallback to billing_software uploads if it exists locally
const localBillingUploads = 'D:\\zorvian_projects\\billing_software\\server\\uploads';
if (fs.existsSync(localBillingUploads)) {
  app.use('/uploads', express.static(localBillingUploads));
}

// REST endpoint to receive bill images from the billing software
app.post('/api/upload-bill', (req, res) => {
  const { billNo, imageBase64, isStock, billDataStr } = req.body;
  if (!billNo || !imageBase64) {
    return res.status(400).json({ ok: false, error: 'Missing billNo or imageBase64' });
  }

  const key = `${isStock ? 'stock' : 'bill'}-${billNo}`;
  billImagesCache.set(key, imageBase64);

  // Store bill data JSON for short URL reconstruction
  if (billDataStr) {
    const dataKey = `${isStock ? 'stock' : 'bill'}-data-${billNo}`;
    billDataCache.set(dataKey, billDataStr);
    try {
      const dataFilename = `billdata-${isStock ? 'stock-' : ''}${billNo}.txt`;
      fs.writeFileSync(path.join(tmpDir, dataFilename), billDataStr, 'utf8');
      console.log(`[Server] Cached bill data to tmpDir/${dataFilename}`);
    } catch (err) {
      console.warn('[Server] Failed to write bill data to tmpDir:', err.message);
    }
  }

  // Fallback to write in tmpDir directory (shared on warm Vercel lambdas)
  try {
    const base64Data = imageBase64.replace(/^data:image\/png;base64,/, "");
    const filename = `${isStock ? 'stock-cart' : 'bill'}-${billNo}.png`;
    fs.writeFileSync(path.join(tmpDir, filename), base64Data, 'base64');
    console.log(`[Server] Cached image to tmpDir/${filename}`);
  } catch (err) {
    console.warn('[Server] Failed to write to tmpDir:', err.message);
  }

  return res.json({ ok: true, message: 'Image uploaded and cached successfully' });
});

// REST endpoint to save rating for a bill (forwarding to Billing App / Queueing offline)
app.post('/api/rate-bill', async (req, res) => {
  const { score, billNo, gmail } = req.body;
  const numericScore = parseInt(score, 10);
  if (!numericScore || numericScore < 1 || numericScore > 5) {
    return res.status(400).json({ ok: false, error: 'Invalid score' });
  }

  const targetBillNo = billNo || 'general';
  const targetGmail = gmail ? gmail.toLowerCase().trim() : '';

  try {
    // Attempt to submit rating to Billing App
    const response = await fetch(`${BILLING_APP_URL}/api/ratings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ score: numericScore, billNo: targetBillNo, gmail: targetGmail })
    });

    if (response.ok) {
      const data = await response.json();
      if (!data.ok) {
        return res.json({ ok: false, error: data.error });
      }
      
      const updatedStats = {
        totalRating: data.totalRating,
        ratingCount: data.ratingCount,
        averageRating: data.averageRating
      };
      saveCachedRatings(updatedStats);
      return res.json({
        ok: true,
        average: parseFloat(updatedStats.averageRating),
        count: updatedStats.ratingCount
      });
    }
  } catch (err) {
    console.log('[Server] Billing App offline during rating. Queueing in pendingRatings.');
  }

  // Queue the offline rating
  const queue = loadPendingRatings();
  queue.push({ score: numericScore, billNo: targetBillNo, gmail: targetGmail, timestamp: Date.now() });
  savePendingRatings(queue);
  console.log(`[Server] Queued offline rating: ${numericScore} ★. Queue size: ${queue.length}`);

  // Increment the cache locally so it displays the increased count and updated average immediately
  const tempTotalRating = (cachedRatings.totalRating || 0) + numericScore;
  const tempRatingCount = (cachedRatings.ratingCount || 0) + 1;
  const tempAverageRating = tempRatingCount > 0 ? (tempTotalRating / tempRatingCount).toFixed(1) : '0.0';
  
  const tempStats = {
    totalRating: tempTotalRating,
    ratingCount: tempRatingCount,
    averageRating: tempAverageRating
  };
  
  saveCachedRatings(tempStats);

  // Return the updated cache
  return res.json({
    ok: true,
    average: parseFloat(tempStats.averageRating),
    count: tempStats.ratingCount,
    queued: true
  });
});

app.get(['/', '/pay'], (req, res) => {
        // Trigger sync asynchronously in background on page load when running on Vercel
        if (process.env.VERCEL) {
          syncWithBillingApp().catch(e => console.warn('[Server] Sync error during page load:', e.message));
        }

        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Surrogate-Control', 'no-store');

        // Extract query parameters to local variables to prevent read-only issues on req.query
        const shortBillNo = req.query.b || '';
        let amount = req.query.am || '0.00';
        let note = req.query.tn || '';
        let billDataParam = req.query.bd || '';

        // ── Short URL support: ?b=BILLNO&am=AMOUNT ──────────────────────────
        // The billing app generates a short link for WhatsApp. When a customer
        // clicks it, we detect the ?b= param and expand it to the full page,
        // injecting the stored bill data so View Bill works properly.
        if (shortBillNo && !note) {
          // Reconstruct the note from the bill number
          note = `Bill No: ${shortBillNo} | SRI MUTHARAMMAN STORE`;
          amount = req.query.am || '0.00';

          // Inject stored bill data so View Bill modal works
          if (!billDataParam) {
            const regularDataKey = `bill-data-${shortBillNo}`;
            const stockDataKey = `stock-data-${shortBillNo}`;
            if (billDataCache.has(regularDataKey)) {
              billDataParam = billDataCache.get(regularDataKey);
            } else if (billDataCache.has(stockDataKey)) {
              billDataParam = billDataCache.get(stockDataKey);
            } else {
              // Try tmpDir filesystem (persists across warm lambdas)
              try {
                const tmpRegular = path.join(tmpDir, `billdata-${shortBillNo}.txt`);
                const tmpStock = path.join(tmpDir, `billdata-stock-${shortBillNo}.txt`);
                if (fs.existsSync(tmpRegular)) {
                  billDataParam = fs.readFileSync(tmpRegular, 'utf8');
                } else if (fs.existsSync(tmpStock)) {
                  billDataParam = fs.readFileSync(tmpStock, 'utf8');
                }
              } catch (e) { /* silent */ }
            }
          }
        }

        if (!note) {
          note = 'SRI MUTHARAMMAN STORE';
        }
        // ─────────────────────────────────────────────────────────────────────
        
        // Build the UPI Deep link
        const upiLink = `upi://pay?pa=paytmqr6ylc3j@ptys&pn=SRI%20MUTHARAMMAN%20STORE&am=${encodeURIComponent(amount)}&cu=INR`;

        // Check if there is a cached bill image
        let imageUrl = '';
        let billNo = '';
        
        if (note.startsWith('Bill-')) {
          billNo = note.slice(5).trim();
        } else if (note.startsWith('Bill No:')) {
          billNo = note.slice(8).split('|')[0].trim();
        } else {
          const match = note.match(/Bill\s*(?:No:?)?\s*(\d+)/i);
          if (match) {
            billNo = match[1];
          }
        }
        
        if (billNo) {
          const billKey = `bill-${billNo}`;
          const stockKey = `stock-${billNo}`;
          const billFile = `bill-${billNo}.png`;
          const stockFile = `stock-cart-${billNo}.png`;
          
          // 1. Check in-memory cache first (most reliable on Vercel)
          if (billImagesCache.has(billKey)) {
            imageUrl = billImagesCache.get(billKey);
          } else if (billImagesCache.has(stockKey)) {
            imageUrl = billImagesCache.get(stockKey);
          } 
          // 2. Check tmpDir filesystem
          else if (fs.existsSync(path.join(tmpDir, billFile))) {
            imageUrl = `/tmp-uploads/${billFile}`;
          } else if (fs.existsSync(path.join(tmpDir, stockFile))) {
            imageUrl = `/tmp-uploads/${stockFile}`;
          } 
          // 3. Fallback to standard local paths (for local development)
          else {
            const uploadsDir = options.userDataPath 
              ? path.join(options.userDataPath, 'uploads')
              : path.join(__dirname, 'uploads');
            const billingDir = 'D:\\zorvian_projects\\billing_software\\server\\uploads';
            
            if (fs.existsSync(path.join(uploadsDir, billFile))) {
              imageUrl = billFile;
            } else if (fs.existsSync(path.join(uploadsDir, stockFile))) {
              imageUrl = stockFile;
            } else if (fs.existsSync(path.join(billingDir, billFile))) {
              imageUrl = billFile;
            } else if (fs.existsSync(path.join(billingDir, stockFile))) {
              imageUrl = stockFile;
            }
          }

          // 4. Ultimate fallback: if there is a billNo, always populate imageUrl so the View Bill button is guaranteed to display
          if (!imageUrl) {
            imageUrl = billFile;
          }
        }

        // 5. If billDataParam is provided, guarantee button is shown even if billNo parsing failed
        if (billDataParam && !imageUrl) {
          imageUrl = 'text-receipt.png';
        }

        // Retrieve cached store-wide rating statistics
        const currentAverage = cachedRatings.averageRating !== undefined ? Number(cachedRatings.averageRating).toFixed(1) : '0.0';
        const currentCount = cachedRatings.ratingCount || 0;
        
        // HTML Code
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sri Mutharamman Store - Checkout</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: rgba(30, 41, 59, 0.65);
      --card-border: rgba(255, 255, 255, 0.08);
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #facc15;
      --primary-hover: #eab308;
      --border: #334155;
      --success: #10b981;
      --success-hover: #059669;
    }
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Outfit', sans-serif;
      background-color: var(--bg);
      background-image: 
        radial-gradient(at 0% 0%, rgba(250, 204, 21, 0.04) 0px, transparent 50%),
        radial-gradient(at 100% 100%, rgba(16, 185, 129, 0.04) 0px, transparent 50%),
        radial-gradient(at 50% 50%, rgba(15, 23, 42, 0.3) 0px, transparent 100%);
      color: var(--text);
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      min-height: 100dvh;
      padding: 2.5rem 1.5rem;
      margin: 0;
    }

    /* Page container layout */
    .page-container {
      display: flex;
      flex-direction: row-reverse;
      max-width: 1050px;
      width: 100%;
      gap: 2.5rem;
      align-items: flex-start;
      justify-content: center;
    }

    /* Store Info Dashboard */
    .store-dashboard {
      flex: 1.2;
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
      width: 100%;
    }

    /* Checkout Card Container */
    .checkout-container {
      flex: 0.8;
      width: 100%;
      position: sticky;
      top: 2rem;
    }

    .card {
      background: var(--card-bg);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid var(--card-border);
      border-radius: 28px;
      width: 100%;
      padding: 1.75rem 1.5rem;
      text-align: center;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 40px rgba(250, 204, 21, 0.02);
    }

    /* Consolidated Premium Info Card */
    .store-info-card {
      background: var(--card-bg);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid var(--card-border);
      border-radius: 28px;
      padding: 2.25rem 2rem;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 40px rgba(250, 204, 21, 0.02);
      display: flex;
      flex-direction: column;
      gap: 1.75rem;
      width: 100%;
    }

    .section-divider {
      border: none;
      border-top: 1px dashed rgba(255, 255, 255, 0.08);
      margin: 0.25rem 0;
    }

    /* Scroll reveal animations styling */
    .reveal-on-scroll {
      opacity: 0;
      transform: translateY(20px);
      transition: opacity 0.6s cubic-bezier(0.16, 1, 0.3, 1), transform 0.6s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .reveal-on-scroll.revealed {
      opacity: 1;
      transform: translateY(0);
    }

    @supports (animation-timeline: view()) {
      @media (max-width: 899px) {
        .reveal-on-scroll {
          animation: revealOnScroll linear both;
          animation-timeline: view();
          animation-range: entry 5% cover 25%;
          transition: none !important;
        }
        
        @keyframes revealOnScroll {
          from {
            opacity: 0;
            transform: translateY(40px) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      }
    }

    .store-header-section {
      display: flex;
      align-items: center;
      gap: 1.5rem;
      margin-bottom: 0.25rem;
    }

    .dashboard-logo {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      object-fit: cover;
      border: 3px solid var(--primary);
      box-shadow: 0 8px 20px rgba(250, 204, 21, 0.2);
    }

    .store-title-group {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.2rem;
    }

    .est-badge {
      background: rgba(250, 204, 21, 0.1);
      color: var(--primary);
      font-size: 0.65rem;
      font-weight: 800;
      padding: 0.2rem 0.55rem;
      border-radius: 50px;
      border: 1px solid rgba(250, 204, 21, 0.2);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .store-main-name {
      font-size: 1.55rem;
      font-weight: 900;
      color: #ffffff;
      letter-spacing: -0.02em;
      line-height: 1.1;
    }

    .dashboard-tagline {
      font-size: 0.82rem;
      font-weight: 600;
      color: var(--success);
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .section-title {
      font-size: 1.05rem;
      font-weight: 800;
      color: #ffffff;
      margin-bottom: 0.85rem;
      display: flex;
      align-items: center;
      gap: 0.55rem;
      letter-spacing: -0.01em;
    }

    .icon-gold {
      color: var(--primary);
    }

    .about-text {
      font-size: 0.92rem;
      color: var(--text-muted);
      line-height: 1.6;
      font-weight: 400;
    }

    .about-text.first-para {
      text-indent: 35%;
    }
    @media (max-width: 1024px) {
      .about-text.first-para {
        text-indent: 25%;
      }
    }
    @media (max-width: 899px) {
      .about-text.first-para {
        text-indent: 35%;
      }
    }
    @media (max-width: 600px) {
      .about-text.first-para {
        text-indent: 15%;
      }
    }

    .about-text strong {
      color: #ffffff;
      font-weight: 600;
    }

    .copyright-text {
      font-size: 0.72rem;
      color: var(--text-muted);
      text-align: center;
      margin-top: 1rem;
      opacity: 0.65;
      font-weight: 500;
    }

    /* Hours widget */
    .hours-container {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      align-self: flex-start;
      gap: 0.55rem;
      padding: 0.45rem 0.9rem;
      border-radius: 12px;
      font-size: 0.82rem;
      font-weight: 700;
      transition: all 0.3s ease;
    }

    .status-badge.open {
      background: rgba(16, 185, 129, 0.1);
      color: var(--success);
      border: 1px solid rgba(16, 185, 129, 0.2);
    }

    .status-badge.closed {
      background: rgba(239, 68, 68, 0.1);
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.2);
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      display: inline-block;
    }

    .status-dot.open {
      background-color: var(--success);
      box-shadow: 0 0 10px var(--success);
      animation: pulse 1.8s infinite;
    }

    .status-dot.closed {
      background-color: #ef4444;
    }

    .status-time {
      font-weight: 500;
      opacity: 0.85;
      margin-left: 0.2rem;
    }

    .hours-grid {
      display: flex;
      flex-direction: column;
      gap: 0.65rem;
    }

    .hours-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 0.65rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      font-size: 0.9rem;
    }

    .hours-row:last-child {
      border-bottom: none;
      padding-bottom: 0;
    }

    .hours-row .days {
      font-weight: 600;
      color: #ffffff;
    }

    .hours-row .time {
      color: var(--text-muted);
      font-weight: 500;
    }

    /* Contacts layout */
    .contact-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 0.65rem;
      margin-bottom: 1rem;
    }

    .contact-btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
      padding: 0.75rem 0.4rem;
      border-radius: 16px;
      text-decoration: none;
      font-size: 0.72rem;
      font-weight: 700;
      color: #ffffff;
      transition: all 0.2s ease;
      border: 1px solid rgba(255, 255, 255, 0.05);
      background: rgba(255, 255, 255, 0.015);
    }

    .contact-btn i {
      font-size: 1.15rem;
    }

    .contact-btn.phone {
      color: #3b82f6;
    }
    .contact-btn.phone:hover {
      background: rgba(59, 130, 246, 0.08);
      border-color: rgba(59, 130, 246, 0.25);
      transform: translateY(-2px);
    }

    .contact-btn.whatsapp {
      color: var(--success);
    }
    .contact-btn.whatsapp:hover {
      background: rgba(16, 185, 129, 0.08);
      border-color: rgba(16, 185, 129, 0.25);
      transform: translateY(-2px);
    }

    .contact-btn.email {
      color: #f59e0b;
    }
    .contact-btn.email:hover {
      background: rgba(245, 158, 11, 0.08);
      border-color: rgba(245, 158, 11, 0.25);
      transform: translateY(-2px);
    }

    .contact-btn.maps {
      color: #ec4899;
    }
    .contact-btn.maps:hover {
      background: rgba(236, 72, 153, 0.08);
      border-color: rgba(236, 72, 153, 0.25);
      transform: translateY(-2px);
    }

    .address-box {
      background: rgba(255, 255, 255, 0.015);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 16px;
      padding: 0.85rem 1rem;
      transition: all 0.2s ease;
      cursor: pointer;
    }

    .address-box:hover {
      background: rgba(255, 255, 255, 0.03);
      border-color: rgba(255, 255, 255, 0.1);
    }

    .address-box:hover .copy-badge {
      opacity: 1;
      background: rgba(250, 204, 21, 0.12);
      color: var(--primary);
    }

    .address-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.35rem;
    }

    .address-title {
      font-size: 0.78rem;
      font-weight: 700;
      color: var(--primary);
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }

    .copy-badge {
      font-size: 0.65rem;
      font-weight: 700;
      color: var(--text-muted);
      background: rgba(255, 255, 255, 0.05);
      padding: 0.15rem 0.4rem;
      border-radius: 5px;
      display: flex;
      align-items: center;
      gap: 0.2rem;
      opacity: 0;
      transition: opacity 0.2s, background 0.2s, color 0.2s;
    }



    .address-body {
      font-size: 0.86rem;
      color: var(--text);
      line-height: 1.5;
    }

    /* License badges grid */
    .license-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 0.85rem;
    }

    .license-badge {
      background: rgba(255, 255, 255, 0.015);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 16px;
      padding: 0.85rem 1rem;
      cursor: pointer;
      transition: all 0.2s ease;
      text-align: left;
    }

    .license-badge:hover {
      background: rgba(255, 255, 255, 0.03);
      border-color: rgba(255, 255, 255, 0.1);
    }

    .license-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.25rem;
    }

    .license-label {
      font-size: 0.7rem;
      font-weight: 700;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    .copy-small {
      font-size: 0.7rem;
      color: var(--text-muted);
      opacity: 0;
      transition: opacity 0.2s;
    }

    .license-badge:hover .copy-small {
      opacity: 1;
      color: var(--primary);
    }

    .license-value {
      font-size: 0.85rem;
      font-weight: 700;
      color: #ffffff;
      font-family: monospace;
      letter-spacing: 0.01em;
    }

    /* Checkout Card Styles - Sizing Adjustments */
    .logo-container {
      margin-bottom: 1.25rem;
      display: flex;
      justify-content: center;
    }

    .logo {
      width: 120px;
      height: 120px;
      border-radius: 50%;
      object-fit: cover;
      border: 4px solid var(--primary);
      box-shadow: 0 0 25px rgba(250, 204, 21, 0.2);
    }

    .store-name {
      font-size: 1.3rem;
      font-weight: 900;
      letter-spacing: -0.02em;
      color: #ffffff;
      margin-bottom: 0.2rem;
    }

    .tagline {
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--success);
      letter-spacing: 0.04em;
      margin-bottom: 1.25rem;
    }

    .thank-you {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-top: 1rem;
      margin-bottom: 0.4rem;
      font-weight: 500;
      line-height: 1.35;
      max-width: 90%;
      margin-left: auto;
      margin-right: auto;
      text-align: center;
    }

    .grand-total-simple {
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--text-muted);
      margin-bottom: 1.15rem;
      text-align: center;
      letter-spacing: 0.01em;
    }

    .grand-total-amount-simple {
      color: #ffffff;
      font-weight: 800;
      font-size: 1.25rem;
      margin-left: 0.35rem;
    }

    .pay-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 70%;
      margin-left: auto;
      margin-right: auto;
      background-color: var(--success);
      color: #ffffff; 
      text-decoration: none;
      font-size: 1.02rem;
      font-weight: 800;
      padding: 0.85rem 1rem;
      border-radius: 16px;
      border: none;
      cursor: pointer;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 6px 15px rgba(16, 185, 129, 0.25);
      letter-spacing: 0.01em;
    }

    .pay-btn:hover {
      background-color: var(--success-hover);
      transform: translateY(-2px);
      box-shadow: 0 8px 18px rgba(16, 185, 129, 0.35);
    }

    .pay-btn:active {
      transform: translateY(0);
    }

    .divider {
      border: none;
      border-top: 1px dashed var(--border);
      margin: 1.25rem 0;
    }

    .footer {
      font-size: 0.78rem;
      color: var(--text-muted);
      line-height: 1.5;
    }

    .powered-by {
      font-weight: 600;
      color: var(--text);
    }

    .software-name {
      margin-top: 0.1rem;
      font-size: 0.72rem;
      color: var(--text-muted);
    }

    .social-links {
      display: flex;
      justify-content: center;
      gap: 1.25rem;
      margin-top: 0.85rem;
    }

    .social-icon {
      font-size: 1.15rem;
      transition: transform 0.2s ease, opacity 0.2s ease;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .social-icon:hover {
      transform: scale(1.15);
      opacity: 0.95;
    }

    .social-icon.website {
      color: #3b82f6;
    }

    .social-icon.instagram {
      color: #e1306c;
    }

    .social-icon.whatsapp {
      color: var(--success);
    }

    /* Toast popup copy alert */
    .toast {
      position: fixed;
      bottom: 2rem;
      left: 50%;
      transform: translateX(-50%) translateY(100px);
      background: rgba(16, 185, 129, 0.95);
      color: white;
      padding: 0.7rem 1.4rem;
      border-radius: 50px;
      font-weight: 600;
      box-shadow: 0 10px 25px rgba(16, 185, 129, 0.3);
      z-index: 1000;
      transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s;
      opacity: 0;
      pointer-events: none;
      font-size: 0.88rem;
    }

    .toast.show {
      transform: translateX(-50%) translateY(0);
      opacity: 1;
    }

    .toast.error {
      background: rgba(239, 68, 68, 0.95);
      box-shadow: 0 10px 25px rgba(239, 68, 68, 0.35);
    }

    /* Interactive Star Rating Widget */
    .rating-widget {
      background: rgba(255, 255, 255, 0.015);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 20px;
      padding: 1.15rem 1rem;
      margin-top: 1rem;
      text-align: center;
      transition: all 0.3s ease;
    }

    .rating-widget:hover {
      background: rgba(255, 255, 255, 0.025);
      border-color: rgba(250, 204, 21, 0.15);
    }

    .rating-title {
      font-size: 0.85rem;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 0.5rem;
      letter-spacing: -0.01em;
    }

    .star-rating-container {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 0.6rem;
      margin-bottom: 0.4rem;
    }

    .star-btn {
      background: none;
      border: none;
      cursor: pointer;
      padding: 0.25rem;
      transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }

    .star-btn i {
      font-size: 1.85rem;
      color: rgba(255, 255, 255, 0.2);
      transition: color 0.2s, transform 0.2s, text-shadow 0.2s;
    }

    .star-btn:hover {
      transform: scale(1.22);
    }

    .star-btn.filled i {
      color: var(--primary);
      text-shadow: 0 0 10px rgba(250, 204, 21, 0.3);
    }

    .star-btn.hover-filled i {
      color: #fde047;
      text-shadow: 0 0 8px rgba(253, 224, 71, 0.25);
    }

    .rating-stats {
      font-size: 0.78rem;
      color: var(--text-muted);
      font-weight: 600;
      margin-top: 0.25rem;
      letter-spacing: 0.01em;
    }

    .rating-feedback {
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--success);
      margin-top: 0rem;
      height: 0;
      opacity: 0;
      overflow: hidden;
      transition: all 0.25s ease;
    }

    .rating-feedback.show {
      height: auto;
      opacity: 1;
      margin-top: 0.65rem;
    }

    @keyframes pulse {
      0% {
        transform: scale(0.95);
        box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.5);
      }
      70% {
        transform: scale(1);
        box-shadow: 0 0 0 6px rgba(16, 185, 129, 0);
      }
      100% {
        transform: scale(0.95);
        box-shadow: 0 0 0 0 rgba(16, 185, 129, 0);
      }
    }

    /* View Bill Button */
    .view-bill-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      width: fit-content;
      margin: 0 auto 1.25rem auto;
      background-color: rgba(59, 130, 246, 0.1);
      color: #3b82f6;
      border: 1px solid rgba(59, 130, 246, 0.25);
      font-size: 0.88rem;
      font-weight: 800;
      padding: 0.6rem 1.25rem;
      border-radius: 16px;
      cursor: pointer;
      transition: all 0.25s ease;
      letter-spacing: 0.02em;
    }

    .view-bill-btn:hover {
      background-color: rgba(59, 130, 246, 0.2);
      border-color: rgba(59, 130, 246, 0.45);
      transform: translateY(-1px);
    }

    /* Premium Modal Overlay */
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(11, 15, 25, 0.85);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 2000;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      padding: 1rem;
    }

    .modal-overlay.show {
      opacity: 1;
      pointer-events: auto;
    }

    .modal-content {
      background: #1e293b;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 24px;
      width: 100%;
      max-width: 440px;
      padding: 1.5rem;
      position: relative;
      transform: translateY(30px);
      transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
      box-shadow: 0 30px 60px rgba(0, 0, 0, 0.6);
      display: flex;
      flex-direction: column;
      max-height: 90vh;
    }

    .modal-overlay.show .modal-content {
      transform: translateY(0);
    }

    .modal-actions-container {
      position: absolute;
      top: 1rem;
      right: 1.25rem;
      display: flex;
      align-items: center;
      gap: 0.65rem;
      z-index: 10;
    }

    .modal-close {
      background: rgba(239, 68, 68, 0.1);
      border: none;
      color: #ef4444;
      font-size: 1.5rem;
      cursor: pointer;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
    }

    .modal-close:hover {
      background: rgba(239, 68, 68, 0.2);
      transform: scale(1.05);
    }

    .modal-title {
      font-size: 1.1rem;
      font-weight: 800;
      color: #ffffff;
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .download-modal-btn {
      background: rgba(59, 130, 246, 0.1);
      border: none;
      color: #3b82f6;
      font-size: 1rem;
      cursor: pointer;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
    }

    .download-modal-btn:hover {
      background: rgba(59, 130, 246, 0.2);
      transform: scale(1.05);
    }

    .modal-body {
      overflow-y: auto;
      overflow-x: hidden;
      border-radius: 14px;
      border: 1px solid var(--border);
      background: #ffffff;
      padding: 0.75rem;
      max-height: 60vh;
      box-shadow: inset 0 2px 8px rgba(0,0,0,0.06);
    }

    .modal-body img {
      width: 100%;
      height: auto;
      display: block;
      margin: 0 auto;
    }

    /* Responsive queries */
    @media (max-width: 899px) {
      body {
        padding: 1.25rem 0.75rem;
      }
      
      .page-container {
        flex-direction: column;
        gap: 1.25rem;
      }

      .checkout-container {
        order: -1;
        position: relative;
        width: calc(100% + 20px);
        margin-left: -10px;
        margin-right: -10px;
        padding: 5px 10px 35px 10px;
        overflow: hidden;
        transition: opacity 0.2s ease;
      }

      .checkout-container .card {
        transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), 
                    opacity 0.4s ease, 
                    box-shadow 0.4s ease;
      }

      /* Active scroll-hide state for mobile */
      .checkout-container.card-hidden {
        height: 0 !important;
        margin-bottom: 0 !important;
        padding-top: 0 !important;
        padding-bottom: 0 !important;
        opacity: 0;
        pointer-events: none;
      }

      .checkout-container.card-hidden .card {
        transform: translateY(-40px);
        opacity: 0;
        box-shadow: none;
      }

      .store-dashboard {
        order: 2;
      }

      .store-header-section {
        display: none; /* Already integrated in payment card */
      }

      .store-info-card {
        padding: 1.75rem 1.25rem;
      }

      .license-grid {
        grid-template-columns: 1fr;
        gap: 0.75rem;
      }

      .thank-you {
        font-size: 0.7rem;
        line-height: 1.3;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
      }
    }

    @media (max-width: 480px) {
      .card {
        padding: 1.5rem 1.15rem;
        border-radius: 24px;
      }
      .contact-grid {
        gap: 0.5rem;
      }
      .contact-btn {
        padding: 0.7rem 0.2rem;
        font-size: 0.68rem;
        border-radius: 12px;
      }
    }

    /* Logo Auto-Swap styles (3D Coin Flip) */
    .logo-swap-container {
      position: relative;
      perspective: 1000px;
    }
    
    .logo-swap-container.dashboard-logo {
      width: 80px;
      height: 80px;
    }
    
    .logo-swap-container.checkout-logo {
      width: 120px;
      height: 120px;
      margin: 0 auto;
    }
    
    .logo-swap-inner {
      position: relative;
      width: 100%;
      height: 100%;
      transform-style: preserve-3d;
      transition: transform 1.2s cubic-bezier(0.68, -0.6, 0.32, 1.6);
    }
    
    .logo-swap-container.flipped .logo-swap-inner {
      transform: rotateY(180deg);
    }
    
    .logo-swap-image {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      backface-visibility: hidden;
      -webkit-backface-visibility: hidden;
      object-fit: cover;
    }
    
    .logo-swap-image.front {
      transform: rotateY(0deg);
      z-index: 2;
    }
    
    .logo-swap-image.back {
      transform: rotateY(180deg);
    }

    .logo-swap-container.dashboard-logo,
    .logo-swap-container.dashboard-logo .logo-swap-inner,
    .logo-swap-container.dashboard-logo .logo-swap-image {
      border-radius: 50% !important;
    }
    .dashboard-logo .logo-swap-image {
      border: 3px solid var(--primary);
      box-shadow: 0 8px 20px rgba(250, 204, 21, 0.2);
    }
    
    .logo-swap-container.checkout-logo,
    .logo-swap-container.checkout-logo .logo-swap-inner,
    .logo-swap-container.checkout-logo .logo-swap-image {
      border-radius: 50% !important;
    }
    .checkout-logo .logo-swap-image {
      border: 4px solid var(--primary);
      box-shadow: 0 0 25px rgba(250, 204, 21, 0.2);
    }

    /* Premium Gallery Carousel CSS */
    .gallery-carousel-container {
      position: relative;
      width: 100%;
      height: 250px;
      border-radius: 24px;
      overflow: hidden;
      border: 1px solid var(--card-border);
      box-shadow: 0 15px 35px rgba(0, 0, 0, 0.4);
      margin-bottom: 1.5rem;
      background: #0f172a;
    }

    .gallery-slider {
      width: 100%;
      height: 100%;
      position: relative;
      cursor: pointer;
    }

    .gallery-slide {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      opacity: 0;
      transform: scale(1.05);
      transition: opacity 1s cubic-bezier(0.4, 0, 0.2, 1), transform 1s cubic-bezier(0.4, 0, 0.2, 1);
      pointer-events: none;
    }

    .gallery-slide.active {
      opacity: 1;
      transform: scale(1);
      pointer-events: auto;
    }

    .gallery-slide img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    /* Carousel Nav Buttons */
    .carousel-nav {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      background: rgba(15, 23, 42, 0.7);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #ffffff;
      width: 42px;
      height: 42px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      opacity: 0;
      z-index: 10;
    }

    .gallery-carousel-container:hover .carousel-nav {
      opacity: 1;
    }

    .carousel-nav:hover {
      background: var(--primary);
      color: #0b0f19;
      border-color: var(--primary);
      box-shadow: 0 0 15px rgba(250, 204, 21, 0.4);
      transform: translateY(-50%) scale(1.1);
    }

    .carousel-nav.prev {
      left: 1.25rem;
    }

    .carousel-nav.next {
      right: 1.25rem;
    }

    /* Pagination Dots */
    .carousel-dots {
      position: absolute;
      bottom: 1.25rem;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 0.6rem;
      z-index: 10;
      background: rgba(15, 23, 42, 0.5);
      padding: 0.45rem 0.9rem;
      border-radius: 50px;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border: 1px solid rgba(255, 255, 255, 0.05);
    }

    .carousel-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.35);
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .carousel-dot:hover {
      background: rgba(255, 255, 255, 0.7);
    }

    .carousel-dot.active {
      background: var(--primary);
      width: 22px;
      box-shadow: 0 0 8px rgba(250, 204, 21, 0.3);
    }
  </style>
</head>
<body>
  <div class="page-container">
    
    <!-- Store Info Dashboard (Left Panel / Bottom on Mobile) -->
    <div class="store-dashboard">
      
      <!-- Unified Store Info Card -->
      <div class="store-info-card">
        
        <!-- Store Header Section -->
        <div class="store-header-section">
          <div class="logo-swap-container dashboard-logo">
            <div class="logo-swap-inner">
              <img class="logo-swap-image front" src="/public/sri%20mutharamman%20store%20logo.jpeg" onerror="this.src='/public/zorvian%20logo.jpeg'; this.onerror=function(){this.src='https://images.unsplash.com/photo-1542838132-92c53300491e?w=150&auto=format&fit=crop';}" alt="Store Logo">
              <img class="logo-swap-image back" src="/public/profile%20logo.jpeg" onerror="this.src='/public/zorvian%20logo.jpeg'; this.onerror=function(){this.src='https://images.unsplash.com/photo-1542838132-92c53300491e?w=150&auto=format&fit=crop';}" alt="Profile Logo">
            </div>
          </div>
          <div class="store-title-group">
            <span class="est-badge">Est. 2019</span>
            <h1 class="store-main-name">Sri Mutharamman Store</h1>
            <div class="dashboard-tagline">Quality Products • Honest Prices</div>
          </div>
        </div>

        <hr class="section-divider store-header-section">

        <!-- Image Gallery Carousel -->
        <div class="gallery-carousel-container reveal-on-scroll">
          <div class="gallery-slider" id="gallery-slider">
            <div class="gallery-slide active">
              <img src="/public/1.jpeg" alt="Store Image 1">
            </div>
            <div class="gallery-slide">
              <img src="/public/2.jpeg" alt="Store Image 2">
            </div>
            <div class="gallery-slide">
              <img src="/public/3.jpeg" alt="Store Image 3">
            </div>
            <div class="gallery-slide">
              <img src="/public/4.jpeg" alt="Store Image 4">
            </div>
            <div class="gallery-slide">
              <img src="/public/5.jpeg" alt="Store Image 5">
            </div>
            <div class="gallery-slide">
              <img src="/public/6.jpeg" alt="Store Image 6">
            </div>
            <div class="gallery-slide">
              <img src="/public/7.jpeg" alt="Store Image 7">
            </div>
            <div class="gallery-slide">
              <img src="/public/8.jpeg" alt="Store Image 8">
            </div>
            <div class="gallery-slide">
              <img src="/public/9.jpeg" alt="Store Image 9">
            </div>
          </div>
        </div>

        <!-- About Section -->
        <div class="info-section reveal-on-scroll">
          <h2 class="section-title"><i class="fa-solid fa-store icon-gold"></i> About Our Store</h2>
          <p class="about-text first-para">
            Established in 2019, <strong>Sri Mutharamman Store</strong>,<br>
            owned by <strong>M. Saminathan</strong>, is your trusted neighborhood grocery and department store, committed to providing quality products at fair and honest prices.
          </p>
          <p class="about-text" style="margin-top: 0.65rem;">
            We offer a wide range of groceries, daily essentials, rice varieties, household items, stationery products, snacks, cool drinks, fresh vegetables, fresh fruits, beverages, and many other products to meet the everyday needs of our customers.
          </p>
          <p class="about-text" style="margin-top: 0.65rem;">
            Our goal is to deliver excellent service, quality products, and a pleasant shopping experience for every customer. We are dedicated to maintaining high standards of hygiene, customer satisfaction, and value for money.
          </p>
          <p class="about-text" style="margin-top: 0.65rem;">
            At <strong>Sri Mutharamman Store</strong>, we believe in building lasting relationships with our customers through trust, quality, and reliable service.
          </p>
        </div>

        <hr class="section-divider reveal-on-scroll">

        <!-- Store Hours Section -->
        <div class="info-section reveal-on-scroll">
          <h2 class="section-title"><i class="fa-solid fa-clock icon-gold"></i> Store Hours</h2>
          <div class="hours-container">
            <div id="live-status-badge" class="status-badge closed">
              <span id="live-status-dot" class="status-dot closed"></span>
              <span id="live-status-text">Checking Store Hours...</span>
            </div>
            <div class="hours-grid">
              <div class="hours-row">
                <span class="days">Monday – Saturday</span>
                <span class="time">6:00 AM – 10:00 PM</span>
              </div>
              <div class="hours-row">
                <span class="days">Sunday</span>
                <span class="time">6:00 AM – 9:00 PM</span>
              </div>
            </div>
          </div>
        </div>

        <hr class="section-divider reveal-on-scroll">

        <!-- Trust and Compliance Section -->
        <div class="info-section reveal-on-scroll">
          <h2 class="section-title"><i class="fa-solid fa-shield-halved icon-gold"></i> Trust & Verification</h2>
          <div class="license-grid">
            <div class="license-badge" onclick="copyText('33GGSP55591A1ZY', 'GSTIN', this)">
              <div class="license-header">
                <span class="license-label">GSTIN</span>
                <span class="copy-small"><i class="fa-regular fa-copy"></i></span>
              </div>
              <div class="license-value">33GGSP55591A1ZY</div>
            </div>
            
            <div class="license-badge" onclick="copyText('22426015000178', 'FSSAI License', this)">
              <div class="license-header">
                <span class="license-label">FSSAI License No</span>
                <span class="copy-small"><i class="fa-regular fa-copy"></i></span>
              </div>
              <div class="license-value">22426015000178</div>
            </div>
          </div>
        </div>

        <hr class="section-divider reveal-on-scroll">

        <!-- Quick Connect Section (Placed at the bottom of the card) -->
        <div class="info-section reveal-on-scroll">
          <h2 class="section-title"><i class="fa-solid fa-address-book icon-gold"></i> Quick Connect</h2>
          <div class="contact-grid">
            <a href="tel:9566598832" class="contact-btn phone">
              <i class="fa-solid fa-phone"></i>
              <span>Call Store</span>
            </a>
            <a href="https://wa.me/919566598832?text=Hi%20Sri%20Mutharamman%20Store%2C%20I%20have%20a%20query%20regarding%20my%20bill." target="_blank" class="contact-btn whatsapp">
              <i class="fa-brands fa-whatsapp"></i>
              <span>WhatsApp</span>
            </a>
            <a href="mailto:smssrimutharammanstore@gmail.com?subject=Inquiry%20regarding%20Sri%20Mutharamman%20Store" class="contact-btn email">
              <i class="fa-solid fa-envelope"></i>
              <span>Email Us</span>
            </a>
            <a href="https://maps.app.goo.gl/fFJf6G6zeBaurqRu8" target="_blank" class="contact-btn maps">
              <i class="fa-solid fa-map-location-dot"></i>
              <span>Directions</span>
            </a>
          </div>
          
          <div class="address-box" onclick="copyAddress(this)">
            <div class="address-header">
              <span class="address-title"><i class="fa-solid fa-location-dot"></i> Address</span>
              <span class="copy-badge"><i class="fa-regular fa-copy"></i> Copy</span>
            </div>
            <p class="address-body">No. 7/209, Bannari Amman Nagar, Karattumedu, Coimbatore - 641035</p>
          </div>

          <!-- Interactive Star Rating Widget -->
          <div class="rating-widget">
            <h3 class="rating-title">How was your shopping experience?</h3>
            <div class="star-rating-container" id="star-rating-container">
              <button class="star-btn" onclick="submitRating(1)" data-value="1" title="Poor">
                <i class="fa-regular fa-star"></i>
              </button>
              <button class="star-btn" onclick="submitRating(2)" data-value="2" title="Fair">
                <i class="fa-regular fa-star"></i>
              </button>
              <button class="star-btn" onclick="submitRating(3)" data-value="3" title="Good">
                <i class="fa-regular fa-star"></i>
              </button>
              <button class="star-btn" onclick="submitRating(4)" data-value="4" title="Very Good">
                <i class="fa-regular fa-star"></i>
              </button>
              <button class="star-btn" onclick="submitRating(5)" data-value="5" title="Excellent">
                <i class="fa-regular fa-star"></i>
              </button>
            </div>
            <div id="rating-stats" class="rating-stats">
              ${currentCount > 0 ? `Rating: ${currentAverage} ★ (${currentCount} rating${currentCount > 1 ? 's' : ''})` : 'No ratings yet'}
            </div>
            <div id="rating-feedback" class="rating-feedback"></div>
          </div>

          <div class="copyright-text">© 2026 SMS. All rights reserved.</div>
        </div>
        
      </div>
    </div>

    <!-- Payment & Checkout Panel (Right Panel / Top on Mobile) -->
    <div class="checkout-container">
      <div class="card reveal-on-scroll">
        <div class="logo-container">
          <div class="logo-swap-container checkout-logo">
            <div class="logo-swap-inner">
              <img class="logo-swap-image front" src="/public/sri%20mutharamman%20store%20logo.jpeg" onerror="this.src='/public/zorvian%20logo.jpeg'; this.onerror=function(){this.src='https://images.unsplash.com/photo-1542838132-92c53300491e?w=150&auto=format&fit=crop';}" alt="Store Logo">
              <img class="logo-swap-image back" src="/public/profile%20logo.jpeg" onerror="this.src='/public/zorvian%20logo.jpeg'; this.onerror=function(){this.src='https://images.unsplash.com/photo-1542838132-92c53300491e?w=150&auto=format&fit=crop';}" alt="Profile Logo">
            </div>
          </div>
        </div>
        
        <h1 class="store-name">Sri Mutharamman Store</h1>
        <div class="tagline">Quality Products • Honest Prices</div>
        
        ${imageUrl ? `
        <!-- View Bill Receipt Button -->
        <button id="view-bill-btn" class="view-bill-btn">
          <i class="fa-solid fa-receipt"></i> VIEW BILL
        </button>
        ` : ''}

        ${shortBillNo ? `
        <div class="grand-total-simple">
          Grand Total: <span class="grand-total-amount-simple">₹${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
        ` : ''}

        <a href="${upiLink}" class="pay-btn">
          PAY NOW
        </a>

        <p class="thank-you">Thank you for choosing SRI MUTHARAMMAN STORE. We look forward to serving you every day with quality products and trusted service.</p>
        
        <hr class="divider">
        
        <div class="footer">
          <span class="powered-by">Powered by Zorvian Technologies</span>
          <div class="software-name">Smart Billing Software</div>
          
          <div class="social-links">
            <a href="https://zorvian-technologies.vercel.app" target="_blank" class="social-icon website" title="Website">
              <i class="fa-solid fa-globe"></i>
            </a>
            <a href="https://www.instagram.com/zorvian_technologies?igsh=bWFycHZjZDRwbG5t" target="_blank" class="social-icon instagram" title="Instagram">
              <i class="fa-brands fa-instagram"></i>
            </a>
            <a href="https://wa.me/919943812771" target="_blank" class="social-icon whatsapp" title="WhatsApp">
              <i class="fa-brands fa-whatsapp"></i>
            </a>
          </div>
        </div>
      </div>
    </div>
    
  </div>

  <!-- Bill Receipt Modal -->
  <div id="bill-modal" class="modal-overlay">
    <div class="modal-content">
      <div class="modal-actions-container">
        <button class="modal-close" onclick="closeBillModal()" title="Close Receipt">&times;</button>
      </div>
      <h3 class="modal-title">
        <i class="fa-solid fa-receipt"></i> <span>Bill Receipt</span>
        <button class="download-modal-btn" onclick="downloadBillReceipt()" title="Download Receipt" style="margin-left: 0.25rem;">
          <i class="fa-solid fa-download"></i>
        </button>
      </h3>
      <div class="modal-body">
        <div id="modal-text-receipt" style="display: none; padding: 0.25rem 0;"></div>
        <div id="modal-loading" style="text-align: center; color: var(--text-muted); padding: 2rem 1rem;">
          <i class="fa-solid fa-circle-notch fa-spin" style="font-size: 2rem; color: var(--primary); margin-bottom: 1rem; display: block;"></i>
          <span>Fetching receipt image...</span>
        </div>
        <img id="modal-bill-img" src="" alt="Bill Receipt" style="display: none;" onload="onImageLoadSuccess()" onerror="onImageLoadError()">
        <div id="modal-error" style="display: none; text-align: center; color: #ef4444; padding: 2rem 1rem;">
          <i class="fa-solid fa-circle-xmark" style="font-size: 2.5rem; margin-bottom: 1rem; display: block;"></i>
          <span style="font-weight: 700; font-size: 1rem; color: #ffffff; display: block; margin-bottom: 0.5rem;">Receipt Unavailable</span>
          <span style="font-size: 0.85rem; color: var(--text-muted); line-height: 1.4; display: block;">Your purchase statement is still being processed or was shared offline. Please check your WhatsApp attachments or try again in a few seconds.</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Gmail Prompt Modal -->
  <div id="gmail-modal" class="modal-overlay">
    <div class="modal-content" style="max-width: 400px; padding: 2rem 1.5rem; border-radius: 24px; text-align: center; background: #1e293b; border: 1px solid var(--border);">
      <h3 class="modal-title" style="margin-bottom: 0.75rem; font-weight: 800; font-size: 1.25rem; color: #ffffff; justify-content: center; display: flex; gap: 0.5rem; align-items: center;">
        <i class="fa-solid fa-envelope icon-gold"></i> <span>Verify Gmail</span>
      </h3>
      <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1.25rem; line-height: 1.5;">To submit a general rating, please verify your Gmail address. Only one rating per Gmail is counted.</p>
      <input type="email" id="gmail-input" placeholder="example@gmail.com" style="width: 100%; padding: 0.85rem 1rem; border-radius: 12px; border: 1px solid var(--border); background: rgba(15,23,42,0.4); color: white; font-family: inherit; font-size: 0.95rem; margin-bottom: 1.25rem; outline: none; transition: border-color 0.2s;" />
      <div style="display: flex; gap: 0.75rem; justify-content: center; width: 100%;">
        <button onclick="closeGmailModal()" style="flex: 1; padding: 0.75rem; border-radius: 12px; border: 1px solid var(--border); background: transparent; color: white; font-weight: 700; font-size: 0.9rem; cursor: pointer; transition: all 0.2s;">Cancel</button>
        <button id="gmail-submit-btn" style="flex: 1; padding: 0.75rem; border-radius: 12px; border: none; background: var(--primary); color: #0b0f19; font-weight: 800; font-size: 0.9rem; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 12px rgba(250,204,21,0.2);">Submit</button>
      </div>
    </div>
  </div>

  <!-- Toast notification -->
  <div id="toast" class="toast">Address copied!</div>

  <script>
    const encodedBillData = '${billDataParam}';
    const billNo = '${billNo || "general"}';

    // Live store open/closed status indicator logic based on IST (UTC+5.5)
    function updateLiveStatus() {
      const statusBadge = document.getElementById('live-status-badge');
      const statusDot = document.getElementById('live-status-dot');
      const statusText = document.getElementById('live-status-text');
      
      if (!statusBadge || !statusDot || !statusText) return;
      
      // Get exact time in Coimbatore (IST: UTC + 5:30)
      const now = new Date();
      const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
      const istTime = new Date(utc + (5.5 * 3600000));
      
      const day = istTime.getDay(); // 0 = Sunday, 1-6 = Mon-Sat
      const hours = istTime.getHours();
      const minutes = istTime.getMinutes();
      const totalMinutes = (hours * 60) + minutes;
      
      let isOpen = false;
      let closeTimeStr = '';
      let openTimeStr = '6:00 AM';
      
      if (day === 0) {
        // Sunday: 6:00 AM – 9:00 PM (360 mins to 1260 mins)
        const openMin = 6 * 60;
        const closeMin = 21 * 60;
        if (totalMinutes >= openMin && totalMinutes < closeMin) {
          isOpen = true;
          closeTimeStr = '9:00 PM';
        }
      } else {
        // Mon-Sat: 6:00 AM – 10:00 PM (360 mins to 1320 mins)
        const openMin = 6 * 60;
        const closeMin = 22 * 60;
        if (totalMinutes >= openMin && totalMinutes < closeMin) {
          isOpen = true;
          closeTimeStr = '10:00 PM';
        }
      }
      
      if (isOpen) {
        statusDot.className = 'status-dot open';
        statusText.innerHTML = 'Open Now <span class="status-time">• Closes at ' + closeTimeStr + ' (IST)</span>';
        statusBadge.className = 'status-badge open';
      } else {
        statusDot.className = 'status-dot closed';
        statusText.innerHTML = 'Closed <span class="status-time">• Opens at ' + openTimeStr + ' (IST)</span>';
        statusBadge.className = 'status-badge closed';
      }
    }

    // Toast alert triggers
    function showToast(message, isError) {
      const toast = document.getElementById('toast');
      toast.innerText = message;
      toast.className = 'toast show' + (isError ? ' error' : '');
      setTimeout(() => {
        toast.className = 'toast';
      }, 2500);
    }

    function copyAddress(element) {
      const addressText = "No. 7/209, Bannari Amman Nagar, Karattumedu, Coimbatore - 641035";
      navigator.clipboard.writeText(addressText).then(() => {
        showToast("Address copied to clipboard!");
        if (element) {
          element.style.borderColor = "var(--success)";
          setTimeout(() => { element.style.borderColor = ""; }, 1200);
        }
      }).catch(() => {
        showToast("Failed to copy address.", true);
      });
    }

    function copyText(text, label, element) {
      navigator.clipboard.writeText(text).then(() => {
        showToast(label + " copied to clipboard!");
        if (element) {
          element.style.borderColor = "var(--success)";
          setTimeout(() => { element.style.borderColor = ""; }, 1200);
        }
      }).catch(() => {
        showToast("Failed to copy " + label + ".", true);
      });
    }

    // Update stars appearance based on active rating score
    function updateStarsState() {
      const saved = localStorage.getItem('sms_store_rating_' + billNo);
      let currentRating = 0;
      if (saved) {
        try {
          currentRating = JSON.parse(saved).score;
        } catch(e) {}
      }
      
      const stars = document.querySelectorAll('.star-btn');
      stars.forEach((s, idx) => {
        const icon = s.querySelector('i');
        s.classList.remove('hover-filled');
        if (idx < currentRating) {
          icon.className = 'fa-solid fa-star';
          s.classList.add('filled');
        } else {
          icon.className = 'fa-regular fa-star';
          s.classList.remove('filled');
        }
      });
    }

    // Submit rating to local storage and server
    function openGmailModal(onSubmit) {
      const modal = document.getElementById('gmail-modal');
      const input = document.getElementById('gmail-input');
      const submitBtn = document.getElementById('gmail-submit-btn');
      if (!modal) return;
      
      input.value = '';
      modal.classList.add('show');
      
      submitBtn.onclick = () => {
        const email = input.value.trim().toLowerCase();
        const isGmail = /^[a-zA-Z0-9._%+-]+@gmail\.com$/.test(email);
        if (!isGmail) {
          showToast("Please enter a valid Gmail address (ending in @gmail.com).", true);
          return;
        }
        localStorage.setItem('sms_user_gmail', email);
        modal.classList.remove('show');
        onSubmit(email);
      };
    }

    function closeGmailModal() {
      const modal = document.getElementById('gmail-modal');
      if (modal) modal.classList.remove('show');
    }

    function submitRating(score) {
      if (localStorage.getItem('sms_store_rating_' + billNo)) {
        showToast("You have already rated!", true);
        return;
      }
      
      const feedback = document.getElementById('rating-feedback');
      const stats = document.getElementById('rating-stats');
      
      if (!feedback) return;

      const proceedWithRatingSubmit = (gmailAddress) => {
        // Save rating in localStorage bill-wise (or Gmail-wise)
        localStorage.setItem('sms_store_rating_' + billNo, JSON.stringify({ score: score, gmail: gmailAddress }));
        
        // Update visual stars state
        updateStarsState();
        
        // Send to backend API
        fetch('/api/rate-bill', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            billNo: billNo,
            score: score,
            gmail: gmailAddress
          })
        })
        .then(res => res.json())
        .then(data => {
          if (data.ok) {
            if (stats) {
              stats.innerText = 'Rating: ' + data.average + ' ★ (' + data.count + ' rating' + (data.count > 1 ? 's' : '') + ')';
            }
            showToast("Rating recorded successfully!");
          } else {
            showToast(data.error || "Failed to record rating.", true);
            localStorage.removeItem('sms_store_rating_' + billNo);
            updateStarsState();
          }
        })
        .catch(err => {
          console.error('Failed to submit rating:', err);
          showToast("Failed to sync rating with server.", true);
          localStorage.removeItem('sms_store_rating_' + billNo);
          updateStarsState();
        });
        
        let thankYouMsg = "Thank you! We appreciate your feedback.";
        if (score === 5) thankYouMsg = "We're thrilled you loved your experience! 😍 Thank you!";
        else if (score === 4) thankYouMsg = "Thank you for the wonderful rating! 😊";
        else if (score === 3) thankYouMsg = "Thank you! We're glad you had a good experience. 🙂";
        else thankYouMsg = "Thank you for your honest feedback. We will work to improve! 🙏";
        
        feedback.innerText = thankYouMsg;
        feedback.className = 'rating-feedback show';
      };

      if (billNo === 'general') {
        const storedGmail = localStorage.getItem('sms_user_gmail');
        if (storedGmail) {
          proceedWithRatingSubmit(storedGmail);
        } else {
          openGmailModal((gmail) => {
            proceedWithRatingSubmit(gmail);
          });
        }
      } else {
        proceedWithRatingSubmit('');
      }
    }


    function checkPreviousRating() {
      updateStarsState();
    }

    // Automatic logo swapper with 3-second coin rolling flip animation
    function initLogoSwap() {
      const containers = document.querySelectorAll('.logo-swap-container');
      containers.forEach(container => {
        setInterval(() => {
          container.classList.toggle('flipped');
        }, 3000); // Flip logo every 3 seconds as requested
      });
    }

    // Professional image gallery carousel (without dots)
    function initGalleryCarousel() {
      const container = document.querySelector('.gallery-carousel-container');
      if (!container) return;
      
      const slides = container.querySelectorAll('.gallery-slide');
      const slider = container.querySelector('.gallery-slider');
      
      if (slides.length === 0) return;
      
      let currentIndex = 0;
      let autoplayInterval = null;
      
      function showSlide(index) {
        // Deactivate current slide
        slides[currentIndex].classList.remove('active');
        
        // Calculate new index
        currentIndex = (index + slides.length) % slides.length;
        
        // Activate new slide
        slides[currentIndex].classList.add('active');
      }
      
      function nextSlide() {
        showSlide(currentIndex + 1);
      }
      
      function startAutoplay() {
        autoplayInterval = setInterval(nextSlide, 3500); // Autoplay slide every 3.5 seconds
      }
      
      function stopAutoplay() {
        if (autoplayInterval) {
          clearInterval(autoplayInterval);
        }
      }
      
      // Control bindings - click slider to show next image
      if (slider) {
        slider.addEventListener('click', () => {
          stopAutoplay();
          showSlide(currentIndex + 1);
          startAutoplay();
        });
      }
      
      // Autoplay activation
      startAutoplay();
      
      // Pause transitions when mouse enters container
      container.addEventListener('mouseenter', stopAutoplay);
      container.addEventListener('mouseleave', startAutoplay);
    }

    // High performance mobile card scroll hide/show logic
    function initMobileScrollHide() {
      const checkoutContainer = document.querySelector('.checkout-container');
      const checkoutCard = checkoutContainer ? checkoutContainer.querySelector('.card') : null;
      
      if (!checkoutContainer || !checkoutCard) return;
      
      let lastScrollY = window.scrollY;
      let isHidden = false;
      let cardHeight = 0;
      let ticking = false;
      
      function updateCardHeight() {
        if (window.innerWidth <= 899) {
          // Temporarily remove classes/height to measure natural height
          const wasHidden = checkoutContainer.classList.contains('card-hidden');
          if (wasHidden) {
            checkoutContainer.classList.remove('card-hidden');
            checkoutContainer.style.height = '';
          }
          
          cardHeight = checkoutCard.offsetHeight;
          
          if (wasHidden) {
            checkoutContainer.classList.add('card-hidden');
            checkoutContainer.style.height = '0px';
          } else {
            checkoutContainer.style.height = (cardHeight + 40) + 'px'; // 40px accounts for padding (5px top + 35px bottom)
          }
        } else {
          checkoutContainer.style.height = '';
          checkoutContainer.classList.remove('card-hidden');
        }
      }
      
      // Measure initial height and bind resize
      updateCardHeight();
      window.addEventListener('load', updateCardHeight);
      window.addEventListener('resize', updateCardHeight);
      
      // Keep height updated in case the card contents change dynamically
      const observer = new MutationObserver(updateCardHeight);
      observer.observe(checkoutCard, { childList: true, subtree: true, attributes: true });
      
      window.addEventListener('scroll', function() {
        if (window.innerWidth > 899) return;
        
        if (!ticking) {
          window.requestAnimationFrame(function() {
            const currentScrollY = window.scrollY;
            const scrollDelta = currentScrollY - lastScrollY;
            
            // Check scroll direction and threshold
            // Micro-jitter protection: only triggers if scroll delta is greater than 8px
            if (Math.abs(scrollDelta) > 8) {
              if (scrollDelta > 0 && currentScrollY > 120) {
                // Scrolling down and past threshold -> Hide card
                if (!isHidden) {
                  checkoutContainer.classList.add('card-hidden');
                  checkoutContainer.style.height = '0px';
                  isHidden = true;
                }
              } else if (scrollDelta < 0 || currentScrollY <= 15) {
                // Scrolling up or reached top -> Show card
                if (isHidden) {
                  checkoutContainer.classList.remove('card-hidden');
                  checkoutContainer.style.height = (cardHeight + 40) + 'px';
                  isHidden = false;
                }
              }
              lastScrollY = currentScrollY;
            }
            ticking = false;
          });
          ticking = true;
        }
      }, { passive: true });
    }

    // Base64 decoder and text-receipt rendering logic
    let parsedBillData = null;
    if (typeof encodedBillData !== 'undefined' && encodedBillData) {
      try {
        parsedBillData = JSON.parse(decodeURIComponent(escape(window.atob(encodedBillData))));
        console.log('[Pay Page] Decoded bill data:', parsedBillData);
      } catch (e) {
        console.error('[Pay Page] Failed to decode bill data:', e);
      }
    }

    function renderTextReceipt(data) {
      var itemsHtml = '';
      var headersHtml = '';
      var totalSection = '';
      var customerMob = data.m || '-';
      var metadataTable = '';

      if (data.isCustomerAccount || data.isSupplierAccount) {
        // Render Account Statement Ledger
        if (data.i && data.i.length > 0) {
          for (var i = 0; i < data.i.length; i++) {
            var entry = data.i[i];
            itemsHtml += '<div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 5px; font-weight: 500; color: #000;">' +
              '<div style="flex: 1.5; text-align: left; word-break: break-word;">' + entry.d + '</div>' +
              '<div style="flex: 1.0; text-align: center;">' +
              '<span style="background: ' + (entry.s === 'Unpaid' ? '#fee2e2' : '#d1fae5') + '; color: ' + (entry.s === 'Unpaid' ? '#ef4444' : '#10b981') + '; padding: 1px 6px; border-radius: 4px; font-size: 9px; font-weight: bold;">' + entry.s + '</span>' +
              '</div>' +
              '<div style="flex: 1.2; text-align: right; font-weight: bold;">' + (entry.s === 'Unpaid' ? '+' : '-') + '₹' + Number(entry.a).toFixed(2) + '</div>' +
              '</div>';
          }
        }

        headersHtml = '<div style="display: flex; justify-content: space-between; font-size: 10px; font-weight: bold; margin-bottom: 4px; color: #000;">' +
          '<div style="flex: 1.5; text-align: left;">Date</div>' +
          '<div style="flex: 1.0; text-align: center;">Status</div>' +
          '<div style="flex: 1.2; text-align: right;">Amount</div>' +
          '</div>';

        metadataTable = '<table style="width: 100%; border-collapse: collapse; border-top: 1px dashed #000; border-bottom: 1px dashed #000; margin: 6px 0; font-size: 10px; color: #000;">' +
          '<tr>' +
          '<td style="padding: 3px 0; text-align: left;">Generated: ' + data.d + ' ' + data.t + '</td>' +
          '<td style="padding: 3px 0; text-align: right;">' + (data.isCustomerAccount ? 'Cust ID: ' : 'Supp ID: ') + data.b + '</td>' +
          '</tr>' +
          '<tr>' +
          '<td style="padding: 3px 0; text-align: left;">Name: ' + data.c + '</td>' +
          '<td style="padding: 3px 0; text-align: right;">Mob: ' + customerMob + '</td>' +
          '</tr>' +
          '</table>';

        var outstanding = data.outstanding !== undefined && data.outstanding !== null && !isNaN(Number(data.outstanding)) ? Number(data.outstanding) : 0;
        totalSection = '<div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: bold; margin-top: 4px; color: #000;">' +
          '<span>PENDING TOTAL</span>' +
          '<span>\u20B9 ' + outstanding.toFixed(2) + '</span>' +
          '</div>';
      } else {
        // Render Standard/Stock/Calc Bills
        if (data.i && data.i.length > 0) {
          for (var i = 0; i < data.i.length; i++) {
            var item = data.i[i];
            itemsHtml += '<div style="display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 5px; font-weight: 500; color: #000;">' +
              '<div style="flex: 2.0; text-align: left; padding-right: 4px; word-break: break-word;">' + item.n + '</div>' +
              '<div style="flex: 0.6; text-align: right; padding-right: 8px;">' + Number(item.r).toFixed(2) + '</div>' +
              '<div style="flex: 0.8; text-align: right; padding-right: 8px;">' + item.q + '</div>' +
              '<div style="flex: 1; text-align: right;">' + Number(item.a).toFixed(2) + '</div>' +
              '</div>';
          }
        }

        headersHtml = '<div style="display: flex; justify-content: space-between; font-size: 10px; font-weight: bold; margin-bottom: 4px; color: #000;">' +
          '<div style="flex: 2.0; text-align: left;">Items</div>' +
          '<div style="flex: 0.6; text-align: right; padding-right: 8px;">Rate</div>' +
          '<div style="flex: 0.8; text-align: right; padding-right: 8px;">Qty</div>' +
          '<div style="flex: 1; text-align: right;">Amt</div>' +
          '</div>';

        metadataTable = '<table style="width: 100%; border-collapse: collapse; border-top: 1px dashed #000; border-bottom: 1px dashed #000; margin: 6px 0; font-size: 10px; color: #000;">' +
          '<tr>' +
          '<td style="padding: 3px 0; text-align: left;">Date: ' + data.d + '</td>' +
          '<td style="padding: 3px 0; text-align: right;">Time: ' + data.t + '</td>' +
          '</tr>' +
          '<tr>' +
          '<td style="padding: 3px 0; text-align: left;">Bill No: ' + data.b + '</td>' +
          '<td style="padding: 3px 0; text-align: right;">Pay: ' + data.p + '</td>' +
          '</tr>' +
          '<tr>' +
          '<td style="padding: 3px 0; text-align: left;">Name: ' + data.c + '</td>' +
          '<td style="padding: 3px 0; text-align: right;">Mob: ' + customerMob + '</td>' +
          '</tr>' +
          '</table>';

        if (data.isStock) {
          var stockSubtotal = data.s !== undefined && data.s !== null && !isNaN(Number(data.s)) ? Number(data.s) : 0;
          var stockBal = data.bal !== undefined && data.bal !== null && !isNaN(Number(data.bal)) ? Number(data.bal) : 0;
          var stockGt = data.gt !== undefined && data.gt !== null && !isNaN(Number(data.gt)) ? Number(data.gt) : (stockSubtotal + stockBal);
          
          var unpaidVal = data.unpaid !== undefined && data.unpaid !== null && !isNaN(Number(data.unpaid)) ? Number(data.unpaid) : 0;
          var paidVal = data.paid !== undefined && data.paid !== null && !isNaN(Number(data.paid)) ? Number(data.paid) : 0;

          if (unpaidVal > 0 || paidVal > 0) {
            totalSection = '<div style="display: flex; justify-content: space-between; font-size: 11px; margin: 2px 0; color: #000;">' +
              '<span>Unpaid Amount</span>' +
              '<span>' + unpaidVal.toFixed(2) + '</span>' +
              '</div>' +
              '<div style="display: flex; justify-content: space-between; font-size: 11px; margin: 2px 0; color: #000;">' +
              '<span>Paid Amount</span>' +
              '<span>' + paidVal.toFixed(2) + '</span>' +
              '</div>' +
              '<div style="border-top: 1px dashed #000; margin: 5px 0;"></div>' +
              '<div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: bold; margin-top: 4px; color: #000;">' +
              '<span>TOTAL BALANCE</span>' +
              '<span>\u20B9 ' + (unpaidVal - paidVal).toFixed(2) + '</span>' +
              '</div>';
          } else {
            totalSection = '<div style="display: flex; justify-content: space-between; font-size: 11px; margin: 2px 0; color: #000;">' +
              '<span>Sub Total</span>' +
              '<span>' + stockSubtotal.toFixed(2) + '</span>' +
              '</div>';
            if (stockBal) {
              totalSection += '<div style="display: flex; justify-content: space-between; font-size: 11px; margin: 2px 0; color: #000;">' +
                '<span>Previous Balance</span>' +
                '<span>' + stockBal.toFixed(2) + '</span>' +
                '</div>';
            }
            totalSection += '<div style="border-top: 1px dashed #000; margin: 5px 0;"></div>' +
              '<div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: bold; margin-top: 4px; color: #000;">' +
              '<span>GRAND TOTAL</span>' +
              '<span>\u20B9 ' + stockGt.toFixed(2) + '</span>' +
              '</div>';
          }
        } else if (data.isCalc) {
          var calcGt = data.gt !== undefined && data.gt !== null && !isNaN(Number(data.gt)) ? Number(data.gt) : 0;
          totalSection = '<div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: bold; margin-top: 4px; color: #000;">' +
            '<span>TOTAL AMOUNT</span>' +
            '<span>\u20B9 ' + calcGt.toFixed(2) + '</span>' +
            '</div>';
        } else {
          var subtotalVal = data.s !== undefined && data.s !== null && !isNaN(Number(data.s)) ? Number(data.s) : 0;
          var cgstVal = data.cg !== undefined && data.cg !== null && !isNaN(Number(data.cg)) ? Number(data.cg) : (subtotalVal * 0.025);
          var sgstVal = data.sg !== undefined && data.sg !== null && !isNaN(Number(data.sg)) ? Number(data.sg) : (subtotalVal * 0.025);
          var discountVal = data.di !== undefined && data.di !== null && !isNaN(Number(data.di)) ? Number(data.di) : 0;
          var grandTotalVal = data.gt !== undefined && data.gt !== null && !isNaN(Number(data.gt)) ? Number(data.gt) : (subtotalVal + cgstVal + sgstVal - discountVal);

          totalSection = '<div style="display: flex; justify-content: space-between; font-size: 11px; margin: 2px 0; color: #000;">' +
            '<span>Subtotal (Excl. GST)</span>' +
            '<span>' + subtotalVal.toFixed(2) + '</span>' +
            '</div>' +
            '<div style="display: flex; justify-content: space-between; font-size: 11px; margin: 2px 0; color: #000;">' +
            '<span>CGST (2.5%)</span>' +
            '<span>' + cgstVal.toFixed(2) + '</span>' +
            '</div>' +
            '<div style="display: flex; justify-content: space-between; font-size: 11px; margin: 2px 0; color: #000;">' +
            '<span>SGST (2.5%)</span>' +
            '<span>' + sgstVal.toFixed(2) + '</span>' +
            '</div>';
          if (discountVal > 0) {
            totalSection += '<div style="display: flex; justify-content: space-between; font-size: 11px; margin: 2px 0; color: #000;">' +
              '<span>Discount</span>' +
              '<span>-' + discountVal.toFixed(2) + '</span>' +
              '</div>';
          }
          totalSection += '<div style="border-top: 1px dashed #000; margin: 5px 0;"></div>' +
            '<div style="display: flex; justify-content: space-between; font-size: 13px; font-weight: bold; margin-top: 4px; color: #000;">' +
            '<span>GRAND TOTAL</span>' +
            '<span>\u20B9 ' + grandTotalVal.toFixed(2) + '</span>' +
            '</div>';
        }
      }

      return '<div style="font-family: \\\'Arial\\\', sans-serif; color: #000; background: #fff; padding: 14px; border-radius: 12px; line-height: 1.4; width: 100%; box-sizing: border-box; border: 1px solid #cbd5e1;">' +
        '<div style="text-align: center; margin-bottom: 8px;">' +
        '<div style="font-family: \\\'Times New Roman\\\', serif; font-size: 24px; font-weight: 900; margin-bottom: 2px; color: #000;">SMS</div>' +
        '<div style="font-size: 11px; font-weight: 800; text-transform: uppercase; color: #000;">SRI MUTHARAMMAN STORE</div>' +
        '<div style="font-size: 9px; color: #334155; line-height: 1.3; margin-top: 2px;">' +
        'No. 7/209, Bannari Amman Nagar,<br/>' +
        'Karattumedu, Coimbatore<br/>' +
        'Contact: 9566598832 | GSTIN: 33GGSP55591A1ZY' +
        '</div>' +
        '</div>' +
        metadataTable +
        headersHtml +
        '<div style="border-top: 1px dashed #000; margin-bottom: 6px;"></div>' +
        '<div style="max-height: 250px; overflow-y: auto; padding-right: 2px;">' + itemsHtml + '</div>' +
        '<div style="border-top: 1px dashed #000; margin: 6px 0;"></div>' +
        totalSection +
        '<div style="border-top: 1px dashed #000; margin: 6px 0;"></div>' +
        '<div style="text-align: center; margin-top: 8px;">' +
        '<div style="font-weight: bold; font-size: 10px; text-transform: uppercase; color: #000;">THANK YOU! VISIT AGAIN</div>' +
        '<div style="font-size: 8px; color: #475569; margin-top: 2px;">Goods once sold will not be taken back</div>' +
        '</div>' +
        '</div>';
    }

    // Modal actions
    function openBillModal(src) {
      const modal = document.getElementById('bill-modal');
      const textContainer = document.getElementById('modal-text-receipt');
      const img = document.getElementById('modal-bill-img');
      const loading = document.getElementById('modal-loading');
      const errorDiv = document.getElementById('modal-error');
      
      if (modal) {
        if (parsedBillData) {
          // If we have parsed text data, render the text receipt directly
          if (textContainer) {
            textContainer.innerHTML = renderTextReceipt(parsedBillData);
            textContainer.style.display = 'block';
          }
          if (img) img.style.display = 'none';
          if (loading) loading.style.display = 'none';
          if (errorDiv) errorDiv.style.display = 'none';
        } else {
          // Fallback to loading image
          if (textContainer) textContainer.style.display = 'none';
          if (img) img.style.display = 'none';
          if (loading) loading.style.display = 'block';
          if (errorDiv) errorDiv.style.display = 'none';
          if (img) img.src = src;
        }
        modal.classList.add('show');
      }
    }

    function closeBillModal() {
      const modal = document.getElementById('bill-modal');
      if (modal) {
        modal.classList.remove('show');
      }
    }

    function downloadBillReceipt() {
      const textContainer = document.getElementById('modal-text-receipt');
      const img = document.getElementById('modal-bill-img');
      const downloadBtn = document.querySelector('.download-modal-btn');
      
      const fileName = 'bill-receipt-' + billNo + '.png';
      
      if (textContainer && textContainer.style.display !== 'none') {
        const oldContent = downloadBtn.innerHTML;
        downloadBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        downloadBtn.disabled = true;
        
        html2canvas(textContainer, {
          scale: 2,
          useCORS: true,
          backgroundColor: null
        }).then(canvas => {
          const link = document.createElement('a');
          link.download = fileName;
          link.href = canvas.toDataURL('image/png');
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          
          downloadBtn.innerHTML = oldContent;
          downloadBtn.disabled = false;
          showToast("Bill receipt downloaded!");
        }).catch(err => {
          console.error("html2canvas error:", err);
          downloadBtn.innerHTML = oldContent;
          downloadBtn.disabled = false;
          showToast("Failed to render and download bill.", true);
        });
      } else if (img && img.style.display !== 'none' && img.src) {
        const src = img.src;
        if (src.startsWith('data:')) {
          const link = document.createElement('a');
          link.download = fileName;
          link.href = src;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          showToast("Bill receipt downloaded!");
        } else {
          const oldContent = downloadBtn.innerHTML;
          downloadBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
          downloadBtn.disabled = true;
          
          fetch(src)
            .then(response => response.blob())
            .then(blob => {
              const blobUrl = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.download = fileName;
              link.href = blobUrl;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              URL.revokeObjectURL(blobUrl);
              
              downloadBtn.innerHTML = oldContent;
              downloadBtn.disabled = false;
              showToast("Bill receipt downloaded!");
            })
            .catch(err => {
              console.error("Fetch image error:", err);
              const link = document.createElement('a');
              link.download = fileName;
              link.href = src;
              link.target = '_blank';
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              
              downloadBtn.innerHTML = oldContent;
              downloadBtn.disabled = false;
              showToast("Bill receipt download triggered!");
            });
        }
      } else {
        showToast("No receipt available to download.", true);
      }
    }

    function onImageLoadSuccess() {
      const img = document.getElementById('modal-bill-img');
      const loading = document.getElementById('modal-loading');
      if (img) img.style.display = 'block';
      if (loading) loading.style.display = 'none';
    }

    function onImageLoadError() {
      const img = document.getElementById('modal-bill-img');
      const loading = document.getElementById('modal-loading');
      const errorDiv = document.getElementById('modal-error');
      if (img) img.style.display = 'none';
      if (loading) loading.style.display = 'none';
      if (errorDiv) errorDiv.style.display = 'block';
    }

    // Intersection Observer for scroll reveal animations
    document.addEventListener('DOMContentLoaded', function() {
      const revealElements = document.querySelectorAll('.reveal-on-scroll');
      
      const observerOptions = {
        root: null,
        rootMargin: '0px 0px -40px 0px',
        threshold: 0.05
      };
      
      const observer = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed');
          } else {
            entry.target.classList.remove('revealed');
          }
        });
      }, observerOptions);
      
      revealElements.forEach(el => {
        observer.observe(el);
      });
      
      // Also reveal initial top elements directly
      setTimeout(() => {
        const firstCard = document.querySelector('.store-info-card');
        if (firstCard) firstCard.classList.add('revealed');
      }, 100);

      // Check for previously submitted customer ratings
      checkPreviousRating();

      // Bind hover events on rating stars
      const stars = document.querySelectorAll('.star-btn');
      stars.forEach((btn, index) => {
        btn.addEventListener('mouseenter', () => {
          // If already rated, don't show hover effect
          if (localStorage.getItem('sms_store_rating_' + billNo)) return;
          
          stars.forEach((s, idx) => {
            const icon = s.querySelector('i');
            if (idx <= index) {
              icon.className = 'fa-solid fa-star';
              s.classList.add('hover-filled');
            } else {
              icon.className = 'fa-regular fa-star';
              s.classList.remove('hover-filled');
            }
          });
        });
        
        btn.addEventListener('mouseleave', () => {
          updateStarsState();
        });
      });

      // Bind modal triggers
      const modal = document.getElementById('bill-modal');
      if (modal) {
        modal.addEventListener('click', function(e) {
          if (e.target === modal) {
            closeBillModal();
          }
        });
      }

      const gModal = document.getElementById('gmail-modal');
      if (gModal) {
        gModal.addEventListener('click', function(e) {
          if (e.target === gModal) {
            closeGmailModal();
          }
        });
      }
      
      const viewBtn = document.getElementById('view-bill-btn');
      if (viewBtn && parsedBillData) {
        if (parsedBillData.isCustomerAccount || parsedBillData.isSupplierAccount) {
          viewBtn.innerHTML = '<i class="fa-solid fa-file-invoice-dollar"></i> VIEW STATEMENT';
        }
      }
      
      const titleSpan = document.querySelector('#bill-modal .modal-title span');
      const titleIcon = document.querySelector('#bill-modal .modal-title i');
      if (parsedBillData && (parsedBillData.isCustomerAccount || parsedBillData.isSupplierAccount)) {
        if (titleSpan) titleSpan.innerText = 'Account Statement';
        if (titleIcon) {
          titleIcon.className = 'fa-solid fa-file-invoice-dollar';
        }
      }

      if (viewBtn) {
        viewBtn.addEventListener('click', function() {
          let src = '${imageUrl}';
          if (!src.startsWith('data:') && !src.startsWith('/') && !src.startsWith('http')) {
            src = '/uploads/' + src;
          }
          openBillModal(src);
        });
      }
      
      // Initialize logo swap
      initLogoSwap();
      
      // Initialize gallery carousel
      initGalleryCarousel();

      // Initialize mobile summary card hide-on-scroll behavior
      initMobileScrollHide();
    });

    // Initial load and run
    updateLiveStatus();
    setInterval(updateLiveStatus, 30000);
  </script>
</body>
</html>`;
        res.send(html);
      });

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

module.exports = app;
