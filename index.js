const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const options = {};

app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get(['/', '/pay'], (req, res) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Surrogate-Control', 'no-store');

        const amount = req.query.am || '0.00';
        const note = req.query.tn || 'SRI MUTHARAMMAN STORE';
        
        // Build the UPI Deep link
        const upiLink = `upi://pay?pa=paytmqr6ylc3j@ptys&pn=SRI%20MUTHARAMMAN%20STORE&am=${encodeURIComponent(amount)}&cu=INR`;

        // Check if there is a cached bill image in server/uploads
        let imageUrl = '';
        if (note.startsWith('Bill-')) {
          const billNo = note.slice(5).trim();
          const uploadsDir = options.userDataPath 
            ? path.join(options.userDataPath, 'uploads')
            : path.join(__dirname, 'uploads');
          
          const billFile = `bill-${billNo}.png`;
          const stockFile = `stock-cart-${billNo}.png`;
          
          if (fs.existsSync(path.join(uploadsDir, billFile))) {
            imageUrl = billFile;
          } else if (fs.existsSync(path.join(uploadsDir, stockFile))) {
            imageUrl = stockFile;
          }
        }
        
        // HTML Code
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sri Mutharamman Store - Checkout</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #facc15;
      --primary-hover: #eab308;
      --border: #334155;
    }
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Outfit', sans-serif;
      background-color: var(--bg);
      color: var(--text);
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      min-height: 100dvh;
      padding: 1.5rem 1rem;
      margin: 0;
      box-sizing: border-box;
    }

    .card {
      background-color: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 24px;
      width: 100%;
      max-width: 360px;
      padding: 2.25rem 1.75rem;
      text-align: center;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4), 0 0 50px rgba(250, 204, 21, 0.05);
      margin: auto;
    }

    .logo-container {
      margin-bottom: 1.5rem;
      display: flex;
      justify-content: center;
    }

    .logo {
      width: 130px;
      height: 130px;
      border-radius: 50%;
      object-fit: cover;
      border: 4px solid var(--primary);
      box-shadow: 0 0 25px rgba(250, 204, 21, 0.25);
    }

    .store-name {
      font-size: clamp(1.2rem, 6vw, 1.45rem);
      font-weight: 900;
      letter-spacing: -0.02em;
      color: #ffffff;
      margin-bottom: 0.25rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .tagline {
      font-size: 0.82rem;
      font-weight: 600;
      color: #22c55e; /* green color */
      letter-spacing: 0.04em;
      margin-bottom: 1.5rem;
    }

    .thank-you {
      font-size: 0.95rem;
      color: var(--text-muted);
      margin-top: 1.5rem;
      margin-bottom: 0.5rem;
    }

    .grand-total {
      font-size: 1.45rem;
      font-weight: 800;
      color: #ffffff;
      margin-bottom: 1.5rem;
      letter-spacing: -0.02em;
    }

    .grand-total-amount {
      color: var(--primary);
      font-weight: 900;
      margin-left: 0.35rem;
    }

    .pay-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      background-color: #22c55e; /* green color */
      color: #ffffff; 
      text-decoration: none;
      font-size: 1.15rem;
      font-weight: 800;
      padding: 1.1rem;
      border-radius: 16px;
      border: none;
      cursor: pointer;
      transition: all 0.25s ease;
      box-shadow: 0 10px 20px rgba(34, 197, 94, 0.3);
    }

    .pay-btn:hover {
      background-color: #16a34a; /* hover green color */
      transform: translateY(-2px);
      box-shadow: 0 12px 24px rgba(34, 197, 94, 0.4);
    }

    .pay-btn:active {
      transform: translateY(0);
    }

    .divider {
      border: none;
      border-top: 1px dashed var(--border);
      margin: 1.5rem 0 1.75rem 0;
    }

    .footer {
      font-size: 0.8rem;
      color: var(--text-muted);
      line-height: 1.5;
    }

    .powered-by {
      font-weight: 600;
      color: var(--text);
    }

    .software-name {
      margin-top: 0.15rem;
      font-size: 0.75rem;
      color: var(--text-muted);
    }

    .social-links {
      display: flex;
      justify-content: center;
      gap: 1.5rem;
      margin-top: 1.25rem;
    }

    .social-icon {
      font-size: 1.35rem;
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
      color: #25d366;
    }
    @media (max-width: 480px) {
      body {
        padding: 0;
        background-color: var(--card-bg);
      }
      .card {
        max-width: 100%;
        min-height: 100vh;
        min-height: 100dvh;
        border-radius: 0;
        border: none;
        display: flex;
        flex-direction: column;
        justify-content: center;
      }
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo-container">
      <img class="logo" src="/public/sri%20mutharamman%20store%20logo.jpeg" onerror="this.src='/public/zorvian%20logo.jpeg'; this.onerror=function(){this.src='https://images.unsplash.com/photo-1542838132-92c53300491e?w=150&auto=format&fit=crop';}" alt="Store Logo">
    </div>
    
    <h1 class="store-name">Sri Mutharamman Store</h1>
    <div class="tagline">Quality Products • Honest Prices</div>
    
    ${imageUrl ? `
    <!-- Scrollable Bill Receipt Image -->
    <div style="margin-bottom: 2rem; width: 100%;">
      <div style="border-radius: 16px; overflow-y: auto; overflow-x: hidden; border: 1px solid var(--border); background: #ffffff; padding: 10px; max-height: 380px; box-shadow: inset 0 2px 8px rgba(0,0,0,0.05);">
        <img src="/uploads/${imageUrl}" alt="Bill Receipt" style="width: 100%; height: auto; display: block; margin: 0 auto;" />
      </div>
    </div>
    ` : ''}

    <div class="grand-total">
      Grand Total:<span class="grand-total-amount">₹${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
    </div>

    <a href="${upiLink}" class="pay-btn">
      PAY NOW
    </a>

    <p class="thank-you">Thank You for Shopping With Us.</p>
    
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
</body>
</html>`;
        res.send(html);
      });

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
