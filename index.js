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
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
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
      flex-direction: row;
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

    .store-header-section {
      display: flex;
      align-items: center;
      gap: 1.5rem;
      margin-bottom: 0.25rem;
    }

    .dashboard-logo {
      width: 80px;
      height: 80px;
      border-radius: 20px;
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
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .address-box:hover {
      background: rgba(255, 255, 255, 0.03);
      border-color: rgba(255, 255, 255, 0.1);
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
      transition: all 0.2s;
    }

    .address-box:hover .copy-badge {
      background: rgba(250, 204, 21, 0.12);
      color: var(--primary);
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

    .grand-total {
      font-size: 1.1rem;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 1rem;
      letter-spacing: -0.01em;
      background: rgba(255, 255, 255, 0.02);
      padding: 0.55rem 0.85rem;
      border-radius: 14px;
      border: 1px solid rgba(255, 255, 255, 0.04);
      display: flex;
      justify-content: space-between;
      align-items: center;
      width: 70%;
      margin-left: auto;
      margin-right: auto;
    }

    .grand-total-amount {
      color: var(--primary);
      font-weight: 900;
      font-size: 1.25rem;
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

    /* Interactive Emoji Rating Widget */
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
      font-size: 0.82rem;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 0.75rem;
      letter-spacing: -0.01em;
    }

    .emoji-container {
      display: flex;
      justify-content: space-around;
      align-items: center;
      gap: 0.2rem;
    }

    .emoji-btn {
      background: none;
      border: none;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.25rem;
      transition: all 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      padding: 0.25rem;
      border-radius: 12px;
      width: 19%;
    }

    .emoji-icon {
      font-size: 1.55rem;
      transition: transform 0.25s ease;
      filter: grayscale(0.15);
    }

    .emoji-label {
      font-size: 0.62rem;
      color: var(--text-muted);
      font-weight: 600;
      opacity: 0.8;
      transition: color 0.2s;
    }

    .emoji-btn:hover {
      transform: scale(1.18);
    }

    .emoji-btn:hover .emoji-icon {
      filter: grayscale(0) drop-shadow(0 0 6px rgba(250, 204, 21, 0.35));
      transform: translateY(-2px);
    }

    .emoji-btn:hover .emoji-label {
      color: var(--primary);
    }

    .emoji-btn.selected {
      transform: scale(1.12);
    }

    .emoji-btn.selected .emoji-icon {
      filter: grayscale(0) drop-shadow(0 0 8px rgba(16, 185, 129, 0.35));
    }

    .emoji-btn.selected .emoji-label {
      color: var(--success);
    }

    .emoji-btn.dimmed {
      opacity: 0.35;
      transform: scale(0.9);
      filter: grayscale(0.8);
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
        position: static;
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
          <img class="dashboard-logo" src="/public/sri%20mutharamman%20store%20logo.jpeg" onerror="this.src='/public/zorvian%20logo.jpeg'; this.onerror=function(){this.src='https://images.unsplash.com/photo-1542838132-92c53300491e?w=150&auto=format&fit=crop';}" alt="Store Logo">
          <div class="store-title-group">
            <span class="est-badge">Est. 2019</span>
            <h1 class="store-main-name">Sri Mutharamman Store</h1>
            <div class="dashboard-tagline">Quality Products • Honest Prices</div>
          </div>
        </div>

        <hr class="section-divider store-header-section">

        <!-- About Section -->
        <div class="info-section reveal-on-scroll">
          <h2 class="section-title"><i class="fa-solid fa-store icon-gold"></i> About Our Store</h2>
          <p class="about-text">
            Established in 2019, <strong>Sri Mutharamman Store</strong> is your trusted neighborhood grocery and department store, committed to providing quality products at fair and honest prices. We offer a wide range of groceries, daily essentials, beverages, rice varieties, household items, stationery products, and more to meet the everyday needs of our customers.
          </p>
          <p class="about-text" style="margin-top: 0.65rem;">
            Our goal is to deliver excellent service, quality products, and a pleasant shopping experience for every customer. We are dedicated to maintaining high standards of hygiene, customer satisfaction, and value for money.
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
            <p class="address-body">No. 7/209, Bannari Amman Nagar, Karattumedu, Coimbatore</p>
          </div>

          <!-- Interactive Emoji Rating Widget -->
          <div class="rating-widget">
            <h3 class="rating-title">How was your shopping experience?</h3>
            <div class="emoji-container" id="emoji-rating-container">
              <button class="emoji-btn" onclick="submitRating(1, '😡')" title="Poor">
                <span class="emoji-icon">😡</span>
                <span class="emoji-label">Poor</span>
              </button>
              <button class="emoji-btn" onclick="submitRating(2, '🙁')" title="Fair">
                <span class="emoji-icon">🙁</span>
                <span class="emoji-label">Fair</span>
              </button>
              <button class="emoji-btn" onclick="submitRating(3, '😐')" title="Good">
                <span class="emoji-icon">😐</span>
                <span class="emoji-label">Good</span>
              </button>
              <button class="emoji-btn" onclick="submitRating(4, '😊')" title="Very Good">
                <span class="emoji-icon">😊</span>
                <span class="emoji-label">Very Good</span>
              </button>
              <button class="emoji-btn" onclick="submitRating(5, '😍')" title="Excellent">
                <span class="emoji-icon">😍</span>
                <span class="emoji-label">Excellent</span>
              </button>
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
          <img class="logo" src="/public/sri%20mutharamman%20store%20logo.jpeg" onerror="this.src='/public/zorvian%20logo.jpeg'; this.onerror=function(){this.src='https://images.unsplash.com/photo-1542838132-92c53300491e?w=150&auto=format&fit=crop';}" alt="Store Logo">
        </div>
        
        <h1 class="store-name">Sri Mutharamman Store</h1>
        <div class="tagline">Quality Products • Honest Prices</div>
        
        ${imageUrl ? `
        <!-- Scrollable Bill Receipt Image -->
        <div style="margin-bottom: 1.5rem; width: 100%;">
          <div style="border-radius: 16px; overflow-y: auto; overflow-x: hidden; border: 1px solid var(--border); background: #ffffff; padding: 10px; max-height: 380px; box-shadow: inset 0 2px 8px rgba(0,0,0,0.05);">
            <img src="/uploads/${imageUrl}" alt="Bill Receipt" style="width: 100%; height: auto; display: block; margin: 0 auto;" />
          </div>
        </div>
        ` : ''}

        <div class="grand-total">
          <span>Grand Total</span>
          <span class="grand-total-amount">₹${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>

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

  <!-- Toast notification -->
  <div id="toast" class="toast">Address copied!</div>

  <script>
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
    function showToast(message) {
      const toast = document.getElementById('toast');
      toast.innerText = message;
      toast.className = 'toast show';
      setTimeout(() => {
        toast.className = 'toast';
      }, 2500);
    }

    function copyAddress(element) {
      const addressText = "No. 7/209, Bannari Amman Nagar, Karattumedu, Coimbatore";
      navigator.clipboard.writeText(addressText).then(() => {
        showToast("Address copied to clipboard!");
        if (element) {
          element.style.borderColor = "var(--success)";
          setTimeout(() => { element.style.borderColor = ""; }, 1200);
        }
      }).catch(() => {
        showToast("Failed to copy address.");
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
        showToast("Failed to copy " + label + ".");
      });
    }

    // Interactive emoji rating widget handler
    function submitRating(score, emoji) {
      const container = document.getElementById('emoji-rating-container');
      const feedback = document.getElementById('rating-feedback');
      
      if (!container || !feedback) return;
      
      const buttons = container.querySelectorAll('.emoji-btn');
      
      // Store rating in localStorage
      localStorage.setItem('sms_store_rating', JSON.stringify({ score, emoji }));
      
      buttons.forEach((btn, index) => {
        if (index + 1 === score) {
          btn.className = 'emoji-btn selected';
        } else {
          btn.className = 'emoji-btn dimmed';
        }
      });
      
      let thankYouMsg = "Thank you! We appreciate your feedback.";
      if (score === 5) thankYouMsg = "We're thrilled you loved your experience! 😍 Thank you!";
      else if (score === 4) thankYouMsg = "Thank you for the wonderful rating! 😊";
      else if (score === 3) thankYouMsg = "Thank you! We're glad you had a good experience. 🙂";
      else thankYouMsg = "Thank you for your honest feedback. We will work to improve! 🙏";
      
      feedback.innerText = thankYouMsg;
      feedback.className = 'rating-feedback show';
      
      showToast("Feedback recorded!");
    }

    function checkPreviousRating() {
      const saved = localStorage.getItem('sms_store_rating');
      if (saved) {
        try {
          const { score, emoji } = JSON.parse(saved);
          const container = document.getElementById('emoji-rating-container');
          const feedback = document.getElementById('rating-feedback');
          if (container && feedback) {
            const buttons = container.querySelectorAll('.emoji-btn');
            buttons.forEach((btn, index) => {
              if (index + 1 === score) {
                btn.className = 'emoji-btn selected';
              } else {
                btn.className = 'emoji-btn dimmed';
              }
            });
            
            let thankYouMsg = "Thank you! We appreciate your feedback.";
            if (score === 5) thankYouMsg = "We're thrilled you loved your experience! 😍 Thank you!";
            else if (score === 4) thankYouMsg = "Thank you for the wonderful rating! 😊";
            else if (score === 3) thankYouMsg = "Thank you! We're glad you had a good experience. 🙂";
            else thankYouMsg = "Thank you for your honest feedback. We will work to improve! 🙏";
            
            feedback.innerText = thankYouMsg;
            feedback.className = 'rating-feedback show';
          }
        } catch (e) {
          // Ignore
        }
      }
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
    });

    // Initial load and run
    updateLiveStatus();
    setInterval(updateLiveStatus, 30000);
  </script>
</body>
</html>`;
        res.send(html);
      });

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
