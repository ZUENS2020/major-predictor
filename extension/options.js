// Options page script for Major Predictor extension

document.addEventListener('DOMContentLoaded', async () => {
  const apiKeyInput = document.getElementById('api-key');
  const tavilyApiKeyInput = document.getElementById('tavily-api-key');
  const modelSelect = document.getElementById('model');
  const autoPredictToggle = document.getElementById('auto-predict');
  const showConfidenceToggle = document.getElementById('show-confidence');
  const includeHltvToggle = document.getElementById('include-hltv');
  const saveBtn = document.getElementById('save-btn');
  const testBtn = document.getElementById('test-btn');
  const refreshModelsBtn = document.getElementById('refresh-models-btn');
  const refreshLogsBtn = document.getElementById('refresh-logs-btn');
  const clearLogsBtn = document.getElementById('clear-logs-btn');
  const logsContainer = document.getElementById('logs-container');
  const logStats = document.getElementById('log-stats');
  const alertSuccess = document.getElementById('alert-success');
  const alertError = document.getElementById('alert-error');

  // Default models as fallback
  const defaultModels = [
    { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet (Recommended)' },
    { id: 'anthropic/claude-3-haiku', name: 'Claude 3 Haiku (Fast)' },
    { id: 'openai/gpt-4o', name: 'GPT-4o' },
    { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini (Budget)' },
    { id: 'google/gemini-pro-1.5', name: 'Gemini Pro 1.5' },
    { id: 'meta-llama/llama-3.1-70b-instruct', name: 'Llama 3.1 70B' }
  ];

  // Load saved settings
  const settings = await chrome.storage.sync.get([
    'openRouterApiKey',
    'tavilyApiKey',
    'aiModel',
    'autoPredict',
    'showConfidence',
    'includeHltv'
  ]);

  if (settings.openRouterApiKey) {
    apiKeyInput.value = settings.openRouterApiKey;
  }
  if (settings.tavilyApiKey) {
    tavilyApiKeyInput.value = settings.tavilyApiKey;
  }
  autoPredictToggle.checked = settings.autoPredict || false;
  showConfidenceToggle.checked = settings.showConfidence !== false; // Default true
  includeHltvToggle.checked = settings.includeHltv !== false; // Default true

  // Fetch models from OpenRouter
  async function fetchModels() {
    modelSelect.innerHTML = '<option value="">Loading models...</option>';
    modelSelect.disabled = true;
    if (refreshModelsBtn) refreshModelsBtn.disabled = true;

    try {
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        const models = data.data || [];
        
        // Sort models by name and filter for chat models
        const chatModels = models
          .filter(m => m.id && m.name)
          .sort((a, b) => {
            // Prioritize popular providers
            const priority = ['anthropic', 'openai', 'google', 'meta-llama'];
            const aProvider = a.id.split('/')[0];
            const bProvider = b.id.split('/')[0];
            const aPriority = priority.indexOf(aProvider);
            const bPriority = priority.indexOf(bProvider);
            
            if (aPriority !== -1 && bPriority === -1) return -1;
            if (aPriority === -1 && bPriority !== -1) return 1;
            if (aPriority !== -1 && bPriority !== -1) return aPriority - bPriority;
            
            return a.name.localeCompare(b.name);
          });

        populateModelSelect(chatModels);
        
        // Restore selected model
        if (settings.aiModel) {
          modelSelect.value = settings.aiModel;
        }
        // If saved model not found or no saved model, select first option
        if (!modelSelect.value && chatModels.length > 0) {
          modelSelect.value = chatModels[0].id;
        }
      } else {
        console.error('Failed to fetch models:', response.status);
        populateModelSelect(defaultModels);
        if (settings.aiModel) modelSelect.value = settings.aiModel;
      }
    } catch (error) {
      console.error('Error fetching models:', error);
      populateModelSelect(defaultModels);
      if (settings.aiModel) modelSelect.value = settings.aiModel;
    } finally {
      modelSelect.disabled = false;
      if (refreshModelsBtn) refreshModelsBtn.disabled = false;
    }
  }

  // Populate the model select dropdown
  function populateModelSelect(models) {
    modelSelect.innerHTML = '';
    
    if (models.length === 0) {
      modelSelect.innerHTML = '<option value="">No models available</option>';
      return;
    }

    models.forEach(model => {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = model.name || model.id;
      modelSelect.appendChild(option);
    });
  }

  // Initial fetch of models
  await fetchModels();

  // Refresh models button
  if (refreshModelsBtn) {
    refreshModelsBtn.addEventListener('click', async () => {
      await fetchModels();
      alertSuccess.textContent = '✓ Models refreshed!';
      showAlert('success');
    });
  }

  // Show alert helper
  function showAlert(type, duration = 3000) {
    const alert = type === 'success' ? alertSuccess : alertError;
    alert.style.display = 'block';
    setTimeout(() => {
      alert.style.display = 'none';
    }, duration);
  }

  // Save settings
  saveBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    const tavilyKey = tavilyApiKeyInput.value.trim();
    
    if (!apiKey) {
      alertError.textContent = '✗ Please enter an API key';
      showAlert('error');
      return;
    }

    try {
      await chrome.storage.sync.set({
        openRouterApiKey: apiKey,
        tavilyApiKey: tavilyKey,
        aiModel: modelSelect.value,
        autoPredict: autoPredictToggle.checked,
        showConfidence: showConfidenceToggle.checked,
        includeHltv: includeHltvToggle.checked
      });
      
      alertSuccess.textContent = '✓ Settings saved successfully!';
      showAlert('success');
    } catch (error) {
      console.error('Error saving settings:', error);
      alertError.textContent = '✗ Error saving settings';
      showAlert('error');
    }
  });

  // Test API connection
  testBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    
    if (!apiKey) {
      alertError.textContent = '✗ Please enter an API key first';
      showAlert('error');
      return;
    }

    testBtn.disabled = true;
    testBtn.textContent = '⏳ Testing...';

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://majors.im',
          'X-Title': 'Major Predictor'
        },
        body: JSON.stringify({
          model: modelSelect.value,
          messages: [
            { role: 'user', content: 'Say "API connection successful" in exactly those words.' }
          ],
          max_tokens: 50
        })
      });

      if (response.ok) {
        alertSuccess.textContent = '✓ API connection successful!';
        showAlert('success');
      } else {
        const error = await response.json();
        alertError.textContent = `✗ API Error: ${error.error?.message || 'Unknown error'}`;
        showAlert('error', 5000);
      }
    } catch (error) {
      console.error('API test error:', error);
      alertError.textContent = '✗ Network error: Could not connect to OpenRouter';
      showAlert('error');
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = '🔍 Test API';
    }
  });

  // ========== 日志功能 ==========
  
  // 加载日志
  async function loadLogs() {
    try {
      const data = await chrome.storage.local.get(['predictionLogs']);
      const logs = data.predictionLogs || [];
      renderLogs(logs);
    } catch (error) {
      console.error('Error loading logs:', error);
      logsContainer.innerHTML = '<div class="log-empty"><p>❌ Error loading logs</p></div>';
    }
  }

  // 渲染日志
  function renderLogs(logs) {
    if (!logs || logs.length === 0) {
      logsContainer.innerHTML = `
        <div class="log-empty">
          <p>💭 No predictions yet</p>
          <p style="font-size: 12px; margin-top: 8px;">Visit majors.im and click "Predict Current Round" to start</p>
        </div>
      `;
      logStats.style.display = 'none';
      return;
    }

    // 计算统计数据
    const totalPredictions = logs.length;
    const rounds = new Set(logs.map(l => l.round)).size;
    const avgConfidence = Math.round(logs.reduce((sum, l) => sum + (l.confidence || 0), 0) / logs.length);

    document.getElementById('stat-total').textContent = totalPredictions;
    document.getElementById('stat-rounds').textContent = rounds;
    document.getElementById('stat-avg-conf').textContent = avgConfidence + '%';
    logStats.style.display = 'flex';

    // 按时间倒序排列，最新的在前面
    const sortedLogs = [...logs].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // 按Round分组
    const groupedByRound = {};
    sortedLogs.forEach(log => {
      const round = log.round || 'Unknown Round';
      if (!groupedByRound[round]) {
        groupedByRound[round] = [];
      }
      groupedByRound[round].push(log);
    });

    let html = '';
    
    for (const [round, roundLogs] of Object.entries(groupedByRound)) {
      html += `<div style="margin-bottom: 24px;">`;
      html += `<h3 style="color: #e94560; margin-bottom: 12px; font-size: 15px;">🎮 ${round}</h3>`;
      
      roundLogs.forEach(log => {
        const statusClass = log.error ? 'error' : 'success';
        const time = new Date(log.timestamp).toLocaleString();
        
        html += `
          <div class="log-block ${statusClass}">
            <div class="log-block-header">
              <div class="log-block-title">
                <span>${log.team1 || 'Team 1'}</span>
                <span style="color: rgba(255,255,255,0.4)">vs</span>
                <span>${log.team2 || 'Team 2'}</span>
              </div>
              <span class="log-block-time">${time}</span>
            </div>
        `;

        if (log.error) {
          html += `
            <div style="color: #f87171;">
              ❌ Error: ${log.error}
            </div>
          `;
        } else {
          html += `
            <div class="log-block-result">
              <span class="log-winner">🏆 ${log.predictedWinner || 'Unknown'}</span>
              <span class="log-confidence">${log.confidence || 0}% confidence</span>
              ${log.riskLevel ? `<span style="color: ${log.riskLevel === 'low' ? '#4ade80' : log.riskLevel === 'high' ? '#f87171' : '#fbbf24'}; font-size: 13px;">Risk: ${log.riskLevel}</span>` : ''}
            </div>
          `;

          // Key Factors
          if (log.keyFactors && log.keyFactors.length > 0) {
            html += `
              <div class="log-factors">
                <div class="log-factors-title">🔑 Key Factors:</div>
            `;
            log.keyFactors.forEach(factor => {
              html += `
                <div class="log-factor">
                  <span class="log-factor-icon">•</span>
                  <span>${factor}</span>
                </div>
              `;
            });
            html += `</div>`;
          }

          // Brief Analysis
          if (log.briefAnalysis) {
            html += `
              <div class="log-analysis">
                <strong>💬 Analysis:</strong> ${log.briefAnalysis}
              </div>
            `;
          }
        }

        html += `</div>`; // end log-block
      });
      
      html += `</div>`; // end round group
    }

    logsContainer.innerHTML = html;
  }

  // 清除日志
  async function clearLogs() {
    if (!confirm('Are you sure you want to clear all prediction logs?')) {
      return;
    }
    
    try {
      await chrome.storage.local.set({ predictionLogs: [] });
      renderLogs([]);
      alertSuccess.textContent = '✓ Logs cleared successfully!';
      showAlert('success');
    } catch (error) {
      console.error('Error clearing logs:', error);
      alertError.textContent = '✗ Error clearing logs';
      showAlert('error');
    }
  }

  // 绑定日志按钮事件
  if (refreshLogsBtn) {
    refreshLogsBtn.addEventListener('click', async () => {
      await loadLogs();
      alertSuccess.textContent = '✓ Logs refreshed!';
      showAlert('success');
    });
  }

  if (clearLogsBtn) {
    clearLogsBtn.addEventListener('click', clearLogs);
  }

  // 初始加载日志
  await loadLogs();
});
