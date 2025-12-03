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
      // Selectors for majors.im, including specific bracket classes
      const matchElements = document.querySelectorAll('.match, .bracket-match, [class*="match-"], [class*="bracket_match"]');
      
      matchElements.forEach(el => {
        const teams = this.extractTeams(el);
        if (teams) {
          const id = `${teams.team1}-vs-${teams.team2}`.toLowerCase().replace(/[^a-z0-9]/g, '-');
          const roundInfo = this.getRoundInfo(el);
          
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

      // Fallback for text-based detection if specific classes aren't found
      if (matches.length === 0) {
        const knownTeams = [
          'Natus Vincere', 'NAVI', 'G2', 'G2 Esports', 'FaZe', 'FaZe Clan',
          'Vitality', 'Team Vitality', 'Astralis', 'MOUZ', 'mousesports',
          'Spirit', 'Team Spirit', 'Heroic', 'Cloud9', 'Complexity',
          'Liquid', 'Team Liquid', 'ENCE', 'BIG', 'Eternal Fire',
          'paiN', 'FURIA', 'Imperial', 'Monte', 'GamerLegion',
          'MIBR', 'TheMongolz', 'Virtus.pro', 'VP', 'Falcons',
          '9z', 'SAW', 'Aurora', 'fnatic', 'NIP', 'Ninjas in Pyjamas'
        ];

        const foundTeams = [];
        const allElements = document.body.getElementsByTagName('*');
        
        for (let el of allElements) {
            // Look for leaf nodes with text
            if (el.children.length === 0 && el.textContent.trim().length > 0) {
                const text = el.textContent.trim();
                // Check if text matches a known team exactly or contains it
                const match = knownTeams.find(t => text === t || (text.length < 30 && text.includes(t)));
                if (match) {
                    foundTeams.push({ element: el, name: match });
                }
            }
        }

        // Pair them up sequentially
        for (let i = 0; i < foundTeams.length - 1; i += 2) {
            const t1 = foundTeams[i];
            const t2 = foundTeams[i+1];
            
            const id = `${t1.name}-vs-${t2.name}`.toLowerCase().replace(/[^a-z0-9]/g, '-');
            
            // Find a common parent to attach the badge
            let commonParent = t1.element.parentElement;
            // Go up at most 5 levels to find a common container
            let levels = 0;
            let container = commonParent;
            while (container && levels < 5) {
                if (container.contains(t2.element)) {
                    break;
                }
                container = container.parentElement;
                levels++;
            }
            
            if (container && levels < 5) {
                const roundInfo = this.getRoundInfo(container);
                matches.push({
                    element: container,
                    id: id,
                    team1: t1.name,
                    team2: t2.name,
                    tournament: document.title,
                    round: roundInfo.name,
                    roundIndex: roundInfo.index
                });
            }
        }
      }

      return matches;
    }

    getRoundInfo(element) {
        let current = element;
        let depth = 0;
        // Traverse up to find a container that has a "Round X" header sibling or child
        while (current && current !== document.body && depth < 6) {
            if (current.parentElement) {
                const siblings = Array.from(current.parentElement.children);
                // Look for a sibling that contains "Round X" text
                const header = siblings.find(s => {
                    if (s === current) return false;
                    const text = s.textContent?.trim();
                    return text && /^Round\s+\d+/i.test(text);
                });
                
                if (header) {
                    const text = header.textContent.trim();
                    const match = text.match(/^Round\s+(\d+)/i);
                    return {
                        name: text,
                        index: match ? parseInt(match[1], 10) : 999
                    };
                }
            }
            current = current.parentElement;
            depth++;
        }
        return { name: 'Unknown Round', index: 999 };
    }

    extractTeams(element) {
      // Heuristic to find team names within a match element
      // Look for elements with 'team' in class or just two distinct text blocks
      const candidates = [];
      
      // Strategy 1: Specific classes
      const teamEls = element.querySelectorAll('[class*="team"], .name, strong');
      teamEls.forEach(t => {
        const text = t.textContent.trim();
        if (text.length > 1 && text.length < 20) candidates.push(text);
      });

      // Strategy 2: Images with alt tags
      if (candidates.length < 2) {
        const imgs = element.querySelectorAll('img[alt]');
        imgs.forEach(img => {
          const alt = img.alt.trim();
          if (alt.length > 1) candidates.push(alt);
        });
      }

      if (candidates.length >= 2) {
        // Filter duplicates and take first two
        const unique = [...new Set(candidates)];
        if (unique.length >= 2) {
          return { team1: unique[0], team2: unique[1] };
        }
      }
      return null;
    }

    async analyzeMatch(match) {
      try {
        logger.info(`Analyzing: ${match.team1} vs ${match.team2}`);
        
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
          logger.success(`Predicted: ${match.team1} vs ${match.team2} -> ${response.prediction.predictedWinner}`);
          return true;
        } else {
          throw new Error(response.error);
        }
      } catch (error) {
        logger.error(`Failed ${match.team1} vs ${match.team2}: ${error.message}`);
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
      
      badge.innerHTML = `
        <span>${prediction.predictedWinner}</span>
        ${confidence}
        <div class="mp-tooltip">
          <div class="mp-tooltip-header">Analysis</div>
          <div>${prediction.briefAnalysis || 'No analysis available'}</div>
          <div style="margin-top:8px; font-size:0.9em; color:#aaa">
            Risk: ${prediction.riskLevel || 'Unknown'}
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
