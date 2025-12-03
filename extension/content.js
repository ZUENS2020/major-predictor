// Content script for Major Predictor extension
// Runs on majors.im to inject predictions

(function() {
  'use strict';

  // State management
  let predictions = new Map();
  let isAnalyzing = false;
  let settings = {};

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }

  async function initialize() {
    console.log('[Major Predictor] Initializing...');
    
    // Load settings
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
      if (response.success) {
        settings = response.settings;
      }
    } catch (error) {
      console.error('[Major Predictor] Error loading settings:', error);
    }

    // Add prediction badges container styles
    addGlobalStyles();

    // If auto-predict is enabled, start prediction
    if (settings.autoPredict && settings.openRouterApiKey) {
      setTimeout(() => startPrediction(), 2000);
    }

    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'startPrediction') {
        startPrediction();
        sendResponse({ success: true });
      } else if (request.action === 'updateAutoPredict') {
        settings.autoPredict = request.value;
        sendResponse({ success: true });
      }
      return true;
    });

    // Watch for dynamic content changes
    observeMatches();
  }

  // Add global styles for prediction badges
  function addGlobalStyles() {
    const styleId = 'major-predictor-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .mp-prediction-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 600;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        margin-left: 8px;
        cursor: pointer;
        transition: all 0.2s ease;
        position: relative;
      }

      .mp-prediction-badge:hover {
        transform: scale(1.05);
      }

      .mp-prediction-badge.team1 {
        background: linear-gradient(135deg, #4ade80 0%, #22c55e 100%);
        color: #052e16;
      }

      .mp-prediction-badge.team2 {
        background: linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%);
        color: #1e3a5f;
      }

      .mp-prediction-badge.uncertain {
        background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
        color: #451a03;
      }

      .mp-prediction-badge.loading {
        background: linear-gradient(135deg, #94a3b8 0%, #64748b 100%);
        color: #f1f5f9;
        animation: pulse 1.5s ease-in-out infinite;
      }

      .mp-prediction-badge.error {
        background: linear-gradient(135deg, #f87171 0%, #ef4444 100%);
        color: #450a0a;
      }

      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.6; }
      }

      .mp-confidence {
        font-size: 10px;
        opacity: 0.9;
        background: rgba(0, 0, 0, 0.2);
        padding: 2px 6px;
        border-radius: 4px;
      }

      .mp-tooltip {
        position: absolute;
        bottom: calc(100% + 8px);
        left: 50%;
        transform: translateX(-50%);
        background: #1e293b;
        color: #f8fafc;
        padding: 12px 16px;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 400;
        min-width: 280px;
        max-width: 350px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
        z-index: 10000;
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.2s, visibility 0.2s;
        text-align: left;
        line-height: 1.5;
      }

      .mp-tooltip::after {
        content: '';
        position: absolute;
        top: 100%;
        left: 50%;
        transform: translateX(-50%);
        border: 8px solid transparent;
        border-top-color: #1e293b;
      }

      .mp-prediction-badge:hover .mp-tooltip {
        opacity: 1;
        visibility: visible;
      }

      .mp-tooltip-header {
        font-weight: 600;
        font-size: 14px;
        margin-bottom: 8px;
        padding-bottom: 8px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }

      .mp-tooltip-section {
        margin-bottom: 8px;
      }

      .mp-tooltip-section:last-child {
        margin-bottom: 0;
      }

      .mp-tooltip-label {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #94a3b8;
        margin-bottom: 4px;
      }

      .mp-tooltip-factors {
        list-style: none;
        padding: 0;
        margin: 0;
      }

      .mp-tooltip-factors li {
        padding: 2px 0;
        padding-left: 16px;
        position: relative;
      }

      .mp-tooltip-factors li::before {
        content: '•';
        position: absolute;
        left: 0;
        color: #4ade80;
      }

      .mp-match-container {
        position: relative;
      }

      .mp-analyze-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        background: linear-gradient(135deg, #e94560 0%, #c73e54 100%);
        color: white;
        border: none;
        border-radius: 4px;
        font-size: 11px;
        cursor: pointer;
        margin-left: 8px;
        transition: all 0.2s ease;
      }

      .mp-analyze-btn:hover {
        transform: scale(1.05);
        background: linear-gradient(135deg, #c73e54 0%, #a33548 100%);
      }

      .mp-analyze-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none;
      }
    `;
    document.head.appendChild(style);
  }

  // Find and process match elements on the page
  function findMatches() {
    // Common match container selectors - may need adjustment based on majors.im structure
    const matchSelectors = [
      '[class*="match"]',
      '[class*="game"]',
      '[class*="fixture"]',
      'div[data-match]',
      '.bracket-match',
      '.match-item',
      '.upcoming-match'
    ];

    const matches = [];
    
    // Try each selector
    for (const selector of matchSelectors) {
      const elements = document.querySelectorAll(selector);
      elements.forEach(el => {
        // Look for team names within the element
        const teamElements = findTeamElements(el);
        if (teamElements.team1 && teamElements.team2) {
          matches.push({
            element: el,
            team1: teamElements.team1,
            team2: teamElements.team2,
            tournament: findTournamentName(el),
            matchType: findMatchType(el)
          });
        }
      });
    }

    // Also try to find any elements containing team vs team patterns
    const allText = document.body.innerText;
    
    return matches;
  }

  // Find team name elements within a match container
  function findTeamElements(container) {
    const result = { team1: null, team2: null };
    
    // Common team selectors
    const teamSelectors = [
      '[class*="team-name"]',
      '[class*="teamName"]',
      '[class*="team"] [class*="name"]',
      '.team-1',
      '.team-2',
      '[class*="opponent"]',
      '[data-team]'
    ];

    const teams = [];
    
    for (const selector of teamSelectors) {
      const elements = container.querySelectorAll(selector);
      elements.forEach(el => {
        const name = el.textContent.trim();
        if (name && name.length > 1 && name.length < 30 && !teams.includes(name)) {
          teams.push(name);
        }
      });
    }

    // Also look for images with alt text containing team names
    const images = container.querySelectorAll('img[alt]');
    images.forEach(img => {
      const alt = img.alt.trim();
      if (alt && alt.length > 1 && alt.length < 30 && !teams.includes(alt)) {
        teams.push(alt);
      }
    });

    if (teams.length >= 2) {
      result.team1 = teams[0];
      result.team2 = teams[1];
    }

    return result;
  }

  // Find tournament name from context
  function findTournamentName(container) {
    const selectors = [
      '[class*="tournament"]',
      '[class*="event"]',
      '[class*="league"]',
      'h1', 'h2', 'h3'
    ];

    for (const selector of selectors) {
      const el = container.closest('[class*="event"]') || document.querySelector(selector);
      if (el) {
        const text = el.textContent.trim();
        if (text.length > 3 && text.length < 100) {
          return text;
        }
      }
    }

    return 'CS2 Major';
  }

  // Find match type (BO1, BO3, etc.)
  function findMatchType(container) {
    const text = container.textContent.toLowerCase();
    if (text.includes('bo5') || text.includes('best of 5')) return 'Best of 5';
    if (text.includes('bo3') || text.includes('best of 3')) return 'Best of 3';
    if (text.includes('bo1') || text.includes('best of 1')) return 'Best of 1';
    return 'Best of 3';
  }

  // Start prediction process
  async function startPrediction() {
    if (isAnalyzing) {
      console.log('[Major Predictor] Already analyzing...');
      return;
    }

    isAnalyzing = true;
    console.log('[Major Predictor] Starting match analysis...');

    try {
      // Find all matches on the page
      const matches = findMatches();
      console.log(`[Major Predictor] Found ${matches.length} matches`);

      if (matches.length === 0) {
        // Try alternative approach - analyze visible team names
        await analyzeVisibleTeams();
        return;
      }

      // Analyze each match
      for (const match of matches) {
        await analyzeMatch(match);
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (error) {
      console.error('[Major Predictor] Error during analysis:', error);
    } finally {
      isAnalyzing = false;
    }
  }

  // Analyze visible teams on the page
  async function analyzeVisibleTeams() {
    // Get page content for analysis
    const pageContent = document.body.innerText;
    
    // Common CS2 team names to look for
    const knownTeams = [
      'Natus Vincere', 'NAVI', 'G2', 'G2 Esports', 'FaZe', 'FaZe Clan',
      'Vitality', 'Team Vitality', 'Astralis', 'MOUZ', 'mousesports',
      'Spirit', 'Team Spirit', 'Heroic', 'Cloud9', 'Complexity',
      'Liquid', 'Team Liquid', 'ENCE', 'BIG', 'Eternal Fire',
      'paiN', 'FURIA', 'Imperial', 'Monte', 'GamerLegion',
      'MIBR', 'TheMongolz', 'Virtus.pro', 'VP', 'Falcons',
      '9z', 'SAW', 'Aurora', 'fnatic', 'NIP', 'Ninjas in Pyjamas'
    ];

    // Find teams mentioned on the page
    const foundTeams = [];
    for (const team of knownTeams) {
      if (pageContent.toLowerCase().includes(team.toLowerCase())) {
        foundTeams.push(team);
      }
    }

    console.log('[Major Predictor] Found teams:', foundTeams);

    // Create match pairs from adjacent teams
    for (let i = 0; i < foundTeams.length - 1; i += 2) {
      const matchData = {
        team1: foundTeams[i],
        team2: foundTeams[i + 1],
        tournament: document.title || 'CS2 Major',
        matchType: 'Best of 3'
      };

      await createPredictionBadgeForPage(matchData);
    }
  }

  // Analyze a single match
  async function analyzeMatch(match) {
    const matchId = `${match.team1}-vs-${match.team2}`.toLowerCase().replace(/\s+/g, '-');
    
    // Check if already predicted
    if (predictions.has(matchId)) {
      return;
    }

    // Add loading badge
    addPredictionBadge(match.element, {
      status: 'loading',
      text: 'Analyzing...'
    }, matchId);

    try {
      // Get prediction from background script
      const response = await chrome.runtime.sendMessage({
        action: 'getPrediction',
        matchData: {
          team1: match.team1,
          team2: match.team2,
          tournament: match.tournament,
          matchType: match.matchType
        }
      });

      if (response.success) {
        predictions.set(matchId, response.prediction);
        updatePredictionBadge(match.element, response.prediction, matchId);
      } else {
        throw new Error(response.error);
      }
    } catch (error) {
      console.error(`[Major Predictor] Error analyzing ${match.team1} vs ${match.team2}:`, error);
      addPredictionBadge(match.element, {
        status: 'error',
        text: 'Error',
        error: error.message
      }, matchId);
    }
  }

  // Create a prediction badge for page-level display
  async function createPredictionBadgeForPage(matchData) {
    const matchId = `${matchData.team1}-vs-${matchData.team2}`.toLowerCase().replace(/\s+/g, '-');
    
    if (predictions.has(matchId)) return;

    // Create a floating prediction container
    let container = document.getElementById('mp-predictions-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'mp-predictions-container';
      container.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: calc(100vh - 100px);
        overflow-y: auto;
        padding: 10px;
      `;
      document.body.appendChild(container);
    }

    // Create match prediction card
    const card = document.createElement('div');
    card.id = `mp-${matchId}`;
    card.style.cssText = `
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      border-radius: 12px;
      padding: 16px;
      min-width: 280px;
      color: white;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
    `;
    card.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <span style="font-size: 13px; font-weight: 600;">${matchData.team1}</span>
        <span style="font-size: 11px; color: #64748b;">vs</span>
        <span style="font-size: 13px; font-weight: 600;">${matchData.team2}</span>
      </div>
      <div class="mp-prediction-status" style="text-align: center; padding: 8px; background: rgba(255,255,255,0.1); border-radius: 6px;">
        <span style="font-size: 12px; color: #94a3b8;">⏳ Analyzing...</span>
      </div>
    `;
    container.appendChild(card);

    try {
      const response = await chrome.runtime.sendMessage({
        action: 'getPrediction',
        matchData: matchData
      });

      const statusEl = card.querySelector('.mp-prediction-status');

      if (response.success) {
        const pred = response.prediction;
        predictions.set(matchId, pred);

        const isTeam1 = pred.predictedWinner === matchData.team1;
        const color = isTeam1 ? '#4ade80' : '#60a5fa';
        
        statusEl.innerHTML = `
          <div style="font-size: 14px; font-weight: 600; color: ${color}; margin-bottom: 4px;">
            🎯 ${pred.predictedWinner}
          </div>
          ${pred.confidence ? `<div style="font-size: 11px; color: #94a3b8;">Confidence: ${pred.confidence}%</div>` : ''}
          ${pred.predictedScore ? `<div style="font-size: 11px; color: #94a3b8;">Score: ${pred.predictedScore}</div>` : ''}
          ${pred.briefAnalysis ? `<div style="font-size: 11px; color: #cbd5e1; margin-top: 8px; line-height: 1.4;">${pred.briefAnalysis.substring(0, 150)}...</div>` : ''}
        `;
      } else {
        statusEl.innerHTML = `<span style="font-size: 12px; color: #f87171;">❌ ${response.error}</span>`;
      }
    } catch (error) {
      const statusEl = card.querySelector('.mp-prediction-status');
      statusEl.innerHTML = `<span style="font-size: 12px; color: #f87171;">❌ ${error.message}</span>`;
    }
  }

  // Add prediction badge to match element
  function addPredictionBadge(element, data, matchId) {
    // Remove existing badge if any
    const existingBadge = element.querySelector(`#mp-badge-${matchId}`);
    if (existingBadge) {
      existingBadge.remove();
    }

    const badge = document.createElement('span');
    badge.id = `mp-badge-${matchId}`;
    badge.className = `mp-prediction-badge ${data.status}`;
    
    if (data.status === 'loading') {
      badge.innerHTML = `<span>⏳</span><span>${data.text}</span>`;
    } else if (data.status === 'error') {
      badge.innerHTML = `
        <span>❌</span>
        <span>${data.text}</span>
        <div class="mp-tooltip">
          <div class="mp-tooltip-header">Prediction Error</div>
          <div>${data.error || 'Unknown error occurred'}</div>
        </div>
      `;
    }

    // Find best place to insert badge
    const insertTarget = findBadgeInsertTarget(element);
    if (insertTarget) {
      insertTarget.appendChild(badge);
    } else {
      element.appendChild(badge);
    }
  }

  // Update prediction badge with results
  function updatePredictionBadge(element, prediction, matchId) {
    const existingBadge = element.querySelector(`#mp-badge-${matchId}`);
    if (!existingBadge) return;

    const isTeam1 = prediction.predictedWinner === prediction.team1;
    const badgeClass = prediction.predictedWinner === 'Uncertain' ? 'uncertain' : (isTeam1 ? 'team1' : 'team2');
    
    existingBadge.className = `mp-prediction-badge ${badgeClass}`;
    
    let confidenceHtml = '';
    if (settings.showConfidence && prediction.confidence) {
      confidenceHtml = `<span class="mp-confidence">${prediction.confidence}%</span>`;
    }

    let factorsHtml = '';
    if (prediction.keyFactors && prediction.keyFactors.length > 0) {
      factorsHtml = `
        <div class="mp-tooltip-section">
          <div class="mp-tooltip-label">Key Factors</div>
          <ul class="mp-tooltip-factors">
            ${prediction.keyFactors.slice(0, 3).map(f => `<li>${f}</li>`).join('')}
          </ul>
        </div>
      `;
    }

    existingBadge.innerHTML = `
      <span>🎯</span>
      <span>${prediction.predictedWinner}</span>
      ${confidenceHtml}
      <div class="mp-tooltip">
        <div class="mp-tooltip-header">
          ${prediction.predictedWinner} to win
          ${prediction.predictedScore ? `(${prediction.predictedScore})` : ''}
        </div>
        ${factorsHtml}
        ${prediction.briefAnalysis ? `
          <div class="mp-tooltip-section">
            <div class="mp-tooltip-label">Analysis</div>
            <div>${prediction.briefAnalysis}</div>
          </div>
        ` : ''}
        ${prediction.riskLevel ? `
          <div class="mp-tooltip-section">
            <div style="color: ${prediction.riskLevel === 'high' ? '#f87171' : prediction.riskLevel === 'medium' ? '#fbbf24' : '#4ade80'};">
              Risk: ${prediction.riskLevel.charAt(0).toUpperCase() + prediction.riskLevel.slice(1)}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  // Find best target element for inserting badge
  function findBadgeInsertTarget(container) {
    // Look for team name containers or match info areas
    const selectors = [
      '[class*="match-info"]',
      '[class*="matchInfo"]',
      '[class*="team-container"]',
      '[class*="versus"]',
      '[class*="vs"]'
    ];

    for (const selector of selectors) {
      const el = container.querySelector(selector);
      if (el) return el;
    }

    return null;
  }

  // Observe DOM for dynamically loaded matches
  function observeMatches() {
    const observer = new MutationObserver((mutations) => {
      let shouldReanalyze = false;
      
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.matches && (
                node.matches('[class*="match"]') ||
                node.matches('[class*="game"]') ||
                node.matches('[class*="fixture"]')
              )) {
                shouldReanalyze = true;
                break;
              }
            }
          }
        }
      }

      if (shouldReanalyze && settings.autoPredict && !isAnalyzing) {
        setTimeout(() => startPrediction(), 1000);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  console.log('[Major Predictor] Content script loaded');
})();
