// Content script for Major Predictor extension
// Runs on majors.im to inject predictions and control panel

(function() {
  'use strict';

  // --- Logger Class ---
  class Logger {
    constructor() {
      this.logs = [];
      this.listeners = [];
    }

    log(message, type = 'info') {
      const entry = {
        timestamp: new Date(),
        message,
        type
      };
      this.logs.push(entry);
      console.log(`[Major Predictor] [${type.toUpperCase()}] ${message}`);
      this.notifyListeners(entry);
    }

    info(message) { this.log(message, 'info'); }
    success(message) { this.log(message, 'success'); }
    warn(message) { this.log(message, 'warn'); }
    error(message) { this.log(message, 'error'); }

    addListener(callback) {
      this.listeners.push(callback);
    }

    notifyListeners(entry) {
      this.listeners.forEach(cb => cb(entry));
    }

    getLogs() {
      return this.logs;
    }
  }

  const logger = new Logger();

  // --- UI Manager Class ---
  class UIManager {
    constructor() {
      this.panel = null;
      this.logModal = null;
      this.isMinimized = false;
    }

    init() {
      this.createControlPanel();
      this.createLogModal();
      logger.addListener(this.appendLogEntry.bind(this));
    }

    createControlPanel() {
      const panel = document.createElement('div');
      panel.className = 'mp-control-panel';
      panel.innerHTML = `
        <div class="mp-panel-header">
          <span class="mp-panel-title">Major Predictor</span>
          <div class="mp-panel-controls">
            <button class="mp-btn" id="mp-minimize-btn">_</button>
          </div>
        </div>
        <div class="mp-status-bar">
          <div class="mp-status-dot" id="mp-status-dot"></div>
          <span id="mp-status-text">Ready</span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <button class="mp-btn mp-btn-primary" id="mp-predict-btn">
            🎯 Predict Current Round
          </button>
          <button class="mp-btn" id="mp-logs-btn">
            📋 View Logs
          </button>
        </div>
      `;
      document.body.appendChild(panel);
      this.panel = panel;

      // Event Listeners
      document.getElementById('mp-minimize-btn').addEventListener('click', () => this.toggleMinimize());
      document.getElementById('mp-logs-btn').addEventListener('click', () => this.toggleLogModal());
      
      // Predict button listener is attached by the main controller
    }

    createLogModal() {
      const modal = document.createElement('div');
      modal.className = 'mp-log-modal hidden';
      modal.innerHTML = `
        <div class="mp-log-header">
          <span class="mp-panel-title">Prediction Logs</span>
          <button class="mp-btn" id="mp-close-logs">✕</button>
        </div>
        <div class="mp-log-content" id="mp-log-content"></div>
      `;
      document.body.appendChild(modal);
      this.logModal = modal;

      document.getElementById('mp-close-logs').addEventListener('click', () => this.toggleLogModal());
    }

    toggleMinimize() {
      this.isMinimized = !this.isMinimized;
      this.panel.classList.toggle('minimized', this.isMinimized);
    }

    toggleLogModal() {
      this.logModal.classList.toggle('hidden');
    }

    updateStatus(status, text) {
      const dot = document.getElementById('mp-status-dot');
      const label = document.getElementById('mp-status-text');
      const btn = document.getElementById('mp-predict-btn');

      dot.className = 'mp-status-dot ' + status;
      label.textContent = text;

      if (status === 'busy') {
        btn.disabled = true;
        btn.textContent = '⏳ Processing...';
      } else {
        btn.disabled = false;
        btn.textContent = '🎯 Predict Current Round';
      }
    }

    appendLogEntry(entry) {
      const container = document.getElementById('mp-log-content');
      if (!container) return;

      const div = document.createElement('div');
      div.className = 'mp-log-entry';
      
      const time = entry.timestamp.toLocaleTimeString();
      const typeClass = `mp-log-${entry.type}`;
      
      div.innerHTML = `
        <span class="mp-log-time">[${time}]</span>
        <span class="${typeClass}">${entry.message}</span>
      `;
      
      container.appendChild(div);
      container.scrollTop = container.scrollHeight;
    }
  }

  // --- Prediction Engine Class ---
  class PredictionEngine {
    constructor(uiManager) {
      this.ui = uiManager;
      this.predictions = new Map();
      this.isAnalyzing = false;
    }

    async predictVisibleMatches() {
      if (this.isAnalyzing) return;

      this.isAnalyzing = true;
      this.ui.updateStatus('busy', 'Scanning matches...');
      logger.info('Starting prediction scan...');

      try {
        const matches = this.findMatches();
        
        if (matches.length === 0) {
          logger.warn('No matches found on screen.');
          this.ui.updateStatus('active', 'No matches found');
          this.isAnalyzing = false;
          return;
        }

        // Filter unpredicted matches
        const pendingMatches = matches.filter(m => !this.predictions.has(m.id));

        if (pendingMatches.length === 0) {
          logger.info('All visible matches already predicted.');
          this.ui.updateStatus('active', 'All predicted');
          this.isAnalyzing = false;
          return;
        }

        // Sort by round index to ensure we process Round 1 -> Round 2 -> ...
        pendingMatches.sort((a, b) => a.roundIndex - b.roundIndex);

        // Identify the target round (the earliest unpredicted round)
        const targetRoundIndex = pendingMatches[0].roundIndex;
        const targetRoundName = pendingMatches[0].round;

        // Select only matches from this specific round
        const currentRoundMatches = pendingMatches.filter(m => m.roundIndex === targetRoundIndex);

        logger.info(`Targeting ${targetRoundName} (${currentRoundMatches.length} matches)...`);
        logger.info(`🔍 Searching HLTV & web for team data...`);
        this.ui.updateStatus('busy', `Predicting ${targetRoundName}...`);

        // Mark all as loading first
        currentRoundMatches.forEach(m => this.addBadge(m.element, { status: 'loading', text: '...' }, m.id));

        // Execute concurrently for this round
        const results = await Promise.allSettled(currentRoundMatches.map(m => this.analyzeMatch(m)));

        const successCount = results.filter(r => r.status === 'fulfilled' && r.value).length;
        logger.success(`${targetRoundName} complete. ${successCount}/${currentRoundMatches.length} predicted.`);
        
        // Check if there are more rounds pending
        const remaining = matches.filter(m => !this.predictions.has(m.id) && m.roundIndex > targetRoundIndex);
        
        if (remaining.length > 0) {
            // Find the next round number
            remaining.sort((a, b) => a.roundIndex - b.roundIndex);
            const nextRound = remaining[0].round;
            this.ui.updateStatus('active', `Next: ${nextRound}`);
            logger.info(`Paused. Click button to predict ${nextRound}.`);
        } else {
            this.ui.updateStatus('active', 'All Rounds Complete');
        }

      } catch (error) {
        logger.error(`Critical error: ${error.message}`);
        this.ui.updateStatus('error', 'Error occurred');
      } finally {
        this.isAnalyzing = false;
      }
    }

    findMatches() {
      const matches = [];
      
      // Primary strategy: Find match containers with bracket_match class (majors.im specific)
      const matchElements = document.querySelectorAll('[class*="bracket_match"], [class*="match_"], .match');
      
      logger.info(`Found ${matchElements.length} potential match elements`);
      
      matchElements.forEach((el, idx) => {
        const teams = this.extractTeams(el);
        if (teams) {
          const id = `${teams.team1}-vs-${teams.team2}`.toLowerCase().replace(/[^a-z0-9]/g, '-');
          const roundInfo = this.getRoundInfo(el);
          
          logger.info(`Match ${idx}: ${teams.team1} vs ${teams.team2} (${roundInfo.name})`);
          
          matches.push({
            element: el,
            id: id,
            team1: teams.team1,
            team2: teams.team2,
            tournament: document.title,
            round: roundInfo.name,
            roundIndex: roundInfo.index
          });
        }
      });

      // Deduplicate matches based on ID
      const uniqueMatches = [];
      const seenIds = new Set();
      for (const m of matches) {
        if (!seenIds.has(m.id)) {
          seenIds.add(m.id);
          uniqueMatches.push(m);
        }
      }
      
      logger.info(`Total unique matches found: ${uniqueMatches.length}`);

      return uniqueMatches;
    }

    getRoundInfo(element) {
        let current = element;
        let depth = 0;
        
        // Traverse up to find a container that has a "Round X" header or "X-X (BoX)" pattern
        while (current && current !== document.body && depth < 10) {
            // Check current element and its siblings
            if (current.parentElement) {
                const parent = current.parentElement;
                
                // Look in siblings for round header
                for (const sibling of parent.children) {
                    const text = sibling.textContent?.trim() || '';
                    
                    // Match "Round X" pattern
                    const roundMatch = text.match(/^Round\s+(\d+)/i);
                    if (roundMatch) {
                        return {
                            name: `Round ${roundMatch[1]}`,
                            index: parseInt(roundMatch[1], 10)
                        };
                    }
                }
                
                // Also check the parent's previous siblings (headers are often before match containers)
                let prevSibling = parent.previousElementSibling;
                while (prevSibling) {
                    const text = prevSibling.textContent?.trim() || '';
                    const roundMatch = text.match(/Round\s+(\d+)/i);
                    if (roundMatch) {
                        return {
                            name: `Round ${roundMatch[1]}`,
                            index: parseInt(roundMatch[1], 10)
                        };
                    }
                    prevSibling = prevSibling.previousElementSibling;
                }
            }
            
            current = current.parentElement;
            depth++;
        }
        
        // Fallback: try to find round info from class names
        let el = element;
        while (el && el !== document.body) {
            const classList = el.className || '';
            if (classList.includes('round')) {
                // Try to extract round number from nearby text
                const roundText = el.querySelector('[class*="round"]')?.textContent || '';
                const match = roundText.match(/Round\s+(\d+)/i);
                if (match) {
                    return { name: `Round ${match[1]}`, index: parseInt(match[1], 10) };
                }
            }
            el = el.parentElement;
        }
        
        return { name: 'Round 1', index: 1 }; // Default to Round 1 if not found
    }

    extractTeams(element) {
      // Strategy for majors.im: look for teamName class or img alt attributes
      const candidates = [];
      
      // Strategy 1: Look for bracket_teamName class (majors.im specific)
      const teamNameEls = element.querySelectorAll('[class*="teamName"], [class*="team-name"], .name');
      teamNameEls.forEach(t => {
        let text = t.textContent.trim();
        // Remove leading numbers/seeds like "1 FURIA" -> "FURIA"
        text = text.replace(/^\d+\s+/, '');
        if (text.length > 1 && text.length < 30) {
          candidates.push(text);
        }
      });

      // Strategy 2: Look for bracket_team class containers
      if (candidates.length < 2) {
        const teamEls = element.querySelectorAll('[class*="bracket_team"]');
        teamEls.forEach(t => {
          // Try to find the team name inside
          const nameEl = t.querySelector('[class*="teamName"], [class*="name"], span');
          if (nameEl) {
            let text = nameEl.textContent.trim();
            text = text.replace(/^\d+\s+/, '');
            if (text.length > 1 && text.length < 30 && !candidates.includes(text)) {
              candidates.push(text);
            }
          }
        });
      }

      // Strategy 3: Images with alt tags (team logos)
      if (candidates.length < 2) {
        const imgs = element.querySelectorAll('img[alt]');
        imgs.forEach(img => {
          const alt = img.alt.trim();
          // Skip common non-team alts
          if (alt.length > 1 && alt.length < 20 && !['logo', 'icon', 'flag'].includes(alt.toLowerCase())) {
            if (!candidates.includes(alt)) {
              candidates.push(alt);
            }
          }
        });
      }

      // Strategy 4: Look for any span/div with team-like content
      if (candidates.length < 2) {
        const allSpans = element.querySelectorAll('span, div');
        const knownTeams = [
          'FURIA', 'Natus Vincere', 'NAVI', 'Team Vitality', 'Vitality', 'FaZe Clan', 'FaZe',
          'Team Falcons', 'Falcons', 'B8', 'The MongolZ', 'MongolZ', 'Imperial Esports', 'Imperial',
          'MOUZ', 'PARIVISION', 'Team Spirit', 'Spirit', 'Team Liquid', 'Liquid',
          'G2 Esports', 'G2', 'Passion UA', 'paiN Gaming', 'paiN', '3DMAX',
          'Aurora Gaming', 'Aurora', 'M80', 'FlyQuest', 'Astralis', 'Ninjas in Pyjamas', 'NIP',
          'TYLOO', 'MIBR', 'fnatic', 'Fnatic', 'ENCE', 'BIG', 'Eternal Fire',
          'Heroic', 'Cloud9', 'Complexity', 'GamerLegion', 'Monte', 'SAW', '9z',
          'Virtus.pro', 'VP'
        ];
        
        allSpans.forEach(span => {
          const text = span.textContent.trim().replace(/^\d+\s+/, '');
          if (knownTeams.some(t => text === t || text.includes(t))) {
            const matchedTeam = knownTeams.find(t => text === t || text.includes(t));
            if (matchedTeam && !candidates.includes(matchedTeam)) {
              candidates.push(matchedTeam);
            }
          }
        });
      }

      if (candidates.length >= 2) {
        // Filter duplicates and take first two unique
        const unique = [...new Set(candidates)];
        if (unique.length >= 2) {
          return { team1: unique[0], team2: unique[1] };
        }
      }
      return null;
    }

    async analyzeMatch(match) {
      try {
        logger.info(`🎯 Analyzing: ${match.team1} vs ${match.team2}`);
        
        const response = await chrome.runtime.sendMessage({
          action: 'getPrediction',
          matchData: {
            team1: match.team1,
            team2: match.team2,
            tournament: match.tournament
          }
        });

        if (response.success) {
          this.predictions.set(match.id, response.prediction);
          this.updateBadge(match.element, response.prediction, match.id);
          
          // Enhanced logging with all key factors
          const pred = response.prediction;
          logger.success(`✅ ${match.team1} vs ${match.team2}`);
          logger.info(`   → Winner: ${pred.predictedWinner} (${pred.confidence}% confidence)`);
          if (pred.predictedScore) {
            logger.info(`   → Predicted Score: ${pred.predictedScore}`);
          }
          // Show all key factors including rankings
          if (pred.keyFactors && pred.keyFactors.length > 0) {
            pred.keyFactors.forEach((factor, i) => {
              logger.info(`   → Factor ${i+1}: ${factor}`);
            });
          }
          // Show brief analysis
          if (pred.briefAnalysis) {
            logger.info(`   → Analysis: ${pred.briefAnalysis.substring(0, 150)}...`);
          }
          return true;
        } else {
          throw new Error(response.error);
        }
      } catch (error) {
        logger.error(`❌ Failed ${match.team1} vs ${match.team2}: ${error.message}`);
        this.addBadge(match.element, { status: 'error', text: 'Err', error: error.message }, match.id);
        return false;
      }
    }

    addBadge(element, data, id) {
      const existing = element.querySelector(`#mp-badge-${id}`);
      if (existing) existing.remove();

      const badge = document.createElement('div');
      badge.id = `mp-badge-${id}`;
      badge.className = `mp-prediction-badge ${data.status}`;
      badge.innerHTML = `<span>${data.text}</span>`;
      
      if (data.error) {
        badge.title = data.error;
      }

      // Insert logic: try to put it between teams or at the end
      element.style.position = 'relative';
      element.appendChild(badge);
    }

    updateBadge(element, prediction, id) {
      const existing = element.querySelector(`#mp-badge-${id}`);
      if (existing) existing.remove();

      const isTeam1 = prediction.predictedWinner === prediction.team1;
      const badgeClass = prediction.predictedWinner === 'Uncertain' ? 'uncertain' : (isTeam1 ? 'team1' : 'team2');
      
      const badge = document.createElement('div');
      badge.id = `mp-badge-${id}`;
      badge.className = `mp-prediction-badge ${badgeClass}`;
      
      const confidence = prediction.confidence ? `<span style="font-size:0.8em; opacity:0.8; margin-left:4px">${prediction.confidence}%</span>` : '';
      
      // Build key factors list
      let factorsHtml = '';
      if (prediction.keyFactors && prediction.keyFactors.length > 0) {
        factorsHtml = `<div style="margin-top:6px; font-size:0.85em;">
          <div style="color:#4ade80; margin-bottom:4px;">Key Factors:</div>
          <ul style="margin:0; padding-left:16px; color:#ddd;">
            ${prediction.keyFactors.slice(0, 3).map(f => `<li>${f}</li>`).join('')}
          </ul>
        </div>`;
      }
      
      badge.innerHTML = `
        <span>${prediction.predictedWinner}</span>
        ${confidence}
        <div class="mp-tooltip">
          <div class="mp-tooltip-header">🎯 AI Prediction</div>
          <div style="margin-top:6px">${prediction.briefAnalysis || 'No analysis available'}</div>
          ${factorsHtml}
          <div style="margin-top:8px; font-size:0.9em; display:flex; gap:12px; color:#aaa">
            <span>Risk: <span style="color:${prediction.riskLevel === 'low' ? '#4ade80' : prediction.riskLevel === 'high' ? '#f87171' : '#fbbf24'}">${prediction.riskLevel || 'Unknown'}</span></span>
            ${prediction.predictedScore ? `<span>Score: ${prediction.predictedScore}</span>` : ''}
          </div>
        </div>
      `;

      element.appendChild(badge);
    }
  }

  // --- Initialization ---
  const ui = new UIManager();
  const engine = new PredictionEngine(ui);

  function init() {
    console.log('[Major Predictor] Initializing v2...');
    ui.init();
    
    // Bind predict button
    document.getElementById('mp-predict-btn').addEventListener('click', () => {
      engine.predictVisibleMatches();
    });

    logger.info('Extension ready. Click "Predict Current Round" to start.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
