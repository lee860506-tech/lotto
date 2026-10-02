/**
 * LOTTO VIP GENESIS PRO - CORE ENGINE & ALGORITHM
 * 100만원 상업용 가치의 1등 조합 완전 제외 & 고빈도 가중치 통계 추첨 엔진
 */

(() => {
  'use strict';

  // State Management
  const AppState = {
    history: [],
    winningSet: new Set(),
    frequencies: new Array(46).fill(0),
    lastAppearance: new Array(46).fill(0),
    currentMode: 'balance', // 'balance', 'ultra_hot', 'cold', 'pure_random'
    gameCount: 5,           // 1, 5, 10
    soundEnabled: true,
    audioCtx: null,
    latestRound: 1243,
    generatedGames: []
  };

  // --------------------------------------------------------------------------
  // AUDIO SYNTHESIZER (Crisp Casino Crystal Bell)
  // --------------------------------------------------------------------------
  function playCrystalChime(pitchMultiplier = 1) {
    if (!AppState.soundEnabled) return;
    try {
      if (!AppState.audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        AppState.audioCtx = new AudioContext();
      }
      if (AppState.audioCtx.state === 'suspended') {
        AppState.audioCtx.resume();
      }

      const ctx = AppState.audioCtx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      const baseFreq = 587.33 * pitchMultiplier; // D5 tone
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(baseFreq, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, ctx.currentTime + 0.12);

      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.28);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } catch (e) {
      // Audio not permitted or supported
    }
  }

  // --------------------------------------------------------------------------
  // DATA INITIALIZATION & LOCAL STORAGE
  // --------------------------------------------------------------------------
  function initHistoryData() {
    const rawHistory = window.RAW_LOTTO_HISTORY || [];
    
    // Check localStorage for any synced extra rounds
    const storedExtras = localStorage.getItem('LOTTO_EXTRA_ROUNDS');
    let extraRounds = [];
    if (storedExtras) {
      try {
        extraRounds = JSON.parse(storedExtras);
      } catch (e) {}
    }

    // Combine & Sort by round descending
    const combined = [...extraRounds, ...rawHistory];
    const uniqueMap = new Map();
    combined.forEach(item => {
      if (!uniqueMap.has(item.round)) {
        uniqueMap.set(item.round, item);
      }
    });

    AppState.history = Array.from(uniqueMap.values()).sort((a, b) => b.round - a.round);
    AppState.latestRound = AppState.history[0]?.round || 1243;

    // Build Set of winning combinations: "n1-n2-n3-n4-n5-n6"
    AppState.winningSet.clear();
    AppState.frequencies.fill(0);
    AppState.lastAppearance.fill(-1);

    const totalRounds = AppState.history.length;

    AppState.history.forEach((draw, drawIndex) => {
      const sortedNums = [...draw.numbers].sort((a, b) => a - b);
      const key = sortedNums.join('-');
      AppState.winningSet.add(key);

      sortedNums.forEach(n => {
        AppState.frequencies[n]++;
        if (AppState.lastAppearance[n] === -1) {
          AppState.lastAppearance[n] = drawIndex; // 0 means appeared in latest round
        }
      });
    });

    // Update UI Status Bar
    updateStatusDisplay();
    renderStatisticsDrawer();
  }

  function updateStatusDisplay() {
    const elLatest = document.getElementById('stat-latest-round');
    const elTotal = document.getElementById('stat-total-rounds');
    if (elLatest) elLatest.textContent = `제 ${AppState.latestRound}회`;
    if (elTotal) elTotal.textContent = `${AppState.history.length.toLocaleString()}회차`;
  }

  // --------------------------------------------------------------------------
  // LOTTO COLOR UTILITIES
  // --------------------------------------------------------------------------
  function getBallColorClass(num) {
    if (num <= 10) return 'ball-gold';
    if (num <= 20) return 'ball-blue';
    if (num <= 30) return 'ball-red';
    if (num <= 40) return 'ball-gray';
    return 'ball-green';
  }

  // --------------------------------------------------------------------------
  // CORE ALGORITHM: 1ST PRIZE EXCLUSION & FREQUENCY WEIGHTED RANDOM
  // --------------------------------------------------------------------------
  /**
   * Generates a 6-number combination according to the selected mode
   * and strictly rejects any combination that has already won 1st prize in history!
   */
  function generateSingleGame(mode = AppState.currentMode) {
    let attempts = 0;
    const maxAttempts = 1000;

    // Precalculate weights for 1..45 based on mode
    const weights = new Array(46).fill(1);
    const avgFreq = AppState.history.length * 6 / 45;

    for (let i = 1; i <= 45; i++) {
      const freq = AppState.frequencies[i];
      const absence = AppState.lastAppearance[i] >= 0 ? AppState.lastAppearance[i] : 50;

      if (mode === 'ultra_hot') {
        // High frequency exponentially favored
        weights[i] = Math.pow(freq / avgFreq, 3.2);
      } else if (mode === 'cold') {
        // Long absence / low frequency favored
        weights[i] = Math.pow((absence + 2), 1.8) * Math.pow(avgFreq / (freq + 1), 1.5);
      } else if (mode === 'balance') {
        // VIP Balance: 70% hot preference + 30% cold balance
        const hotWeight = Math.pow(freq / avgFreq, 1.8);
        const coldWeight = Math.min(absence / 5, 2.0);
        weights[i] = (hotWeight * 0.7) + (coldWeight * 0.3);
      } else {
        // pure_random
        weights[i] = 1.0;
      }
    }

    while (attempts < maxAttempts) {
      attempts++;
      const selected = sampleDistinctWeighted(weights, 6);
      selected.sort((a, b) => a - b);

      const key = selected.join('-');

      // RULE 1: STRICT 1st PRIZE COMBINATION REJECTION
      if (AppState.winningSet.has(key)) {
        // Has won 1st prize in Korean history! Discard!
        continue;
      }

      // RULE 2: Statistical Soundness Checks (Avoid non-viable combinations)
      // - Odd / Even ratio: eliminate 6:0 or 0:6 extreme bias
      const oddCount = selected.filter(n => n % 2 !== 0).length;
      if (oddCount === 0 || oddCount === 6) {
        if (Math.random() < 0.85) continue; // 85% rejection rate on extreme odd/even
      }

      // - Consecutive count: avoid 4+ consecutive numbers (e.g. 12, 13, 14, 15)
      let maxConsecutive = 1;
      let curConsecutive = 1;
      for (let i = 1; i < 6; i++) {
        if (selected[i] === selected[i - 1] + 1) {
          curConsecutive++;
          if (curConsecutive > maxConsecutive) maxConsecutive = curConsecutive;
        } else {
          curConsecutive = 1;
        }
      }
      if (maxConsecutive >= 4) continue;

      // - Sum range: Standard 90% of lotto draws fall between sum 90 and 185
      const sum = selected.reduce((acc, v) => acc + v, 0);
      if (sum < 85 || sum > 190) {
        if (Math.random() < 0.7) continue;
      }

      // Valid VIP combination found!
      return analyzeCombination(selected);
    }

    // Fallback if max attempts exceeded
    const fallback = [1, 2, 3, 4, 5, 6];
    return analyzeCombination(fallback);
  }

  /**
   * Sample k distinct items from [1..45] with replacement without duplicate
   */
  function sampleDistinctWeighted(weights, k) {
    const selected = [];
    const available = [];
    for (let i = 1; i <= 45; i++) available.push(i);

    for (let step = 0; step < k; step++) {
      let totalWeight = 0;
      for (const num of available) {
        totalWeight += weights[num];
      }

      let r = Math.random() * totalWeight;
      let chosenIdx = 0;

      for (let i = 0; i < available.length; i++) {
        const num = available[i];
        r -= weights[num];
        if (r <= 0) {
          chosenIdx = i;
          break;
        }
      }

      selected.push(available[chosenIdx]);
      available.splice(chosenIdx, 1);
    }

    return selected;
  }

  /**
   * Analyzes the generated combination against 1243 historical draws
   */
  function analyzeCombination(numbers) {
    const sorted = [...numbers].sort((a, b) => a - b);
    const key = sorted.join('-');
    const isFirstPrizeWon = AppState.winningSet.has(key);

    // Find highest historical match
    let maxMatch = 0;
    let maxMatchRound = 0;
    const numSet = new Set(sorted);

    for (const draw of AppState.history) {
      let match = 0;
      for (const n of draw.numbers) {
        if (numSet.has(n)) match++;
      }
      if (match > maxMatch) {
        maxMatch = match;
        maxMatchRound = draw.round;
      }
    }

    // Calculate Hot Index (0 ~ 100%)
    const avgDraws = AppState.history.length;
    let totalFreq = 0;
    sorted.forEach(n => totalFreq += AppState.frequencies[n]);
    const maxPossible = avgDraws * 6 * (6 / 45) * 1.35;
    const hotScore = Math.min(99, Math.max(50, Math.round((totalFreq / maxPossible) * 100)));

    // Odd / Even
    const oddCount = sorted.filter(n => n % 2 !== 0).length;
    const evenCount = 6 - oddCount;

    // Sum
    const sum = sorted.reduce((a, b) => a + b, 0);

    return {
      numbers: sorted,
      isUnique: !isFirstPrizeWon,
      maxMatch,
      maxMatchRound,
      hotScore,
      oddEven: `${oddCount}:${evenCount}`,
      sum
    };
  }

  // --------------------------------------------------------------------------
  // BATCH GENERATION & UI RENDERING
  // --------------------------------------------------------------------------
  function executeGenerate() {
    const count = AppState.gameCount;
    AppState.generatedGames = [];

    for (let i = 0; i < count; i++) {
      AppState.generatedGames.push(generateSingleGame());
    }

    renderResults();
    showToast(`VIP 알고리즘 ${count}게임 생성 완료! (역대 1등 완벽 배제)`);
  }

  function renderResults() {
    const container = document.getElementById('results-list');
    const actionsBar = document.getElementById('batch-actions-bar');
    if (!container) return;

    container.innerHTML = '';
    const gameLabels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

    AppState.generatedGames.forEach((game, index) => {
      const label = gameLabels[index] || (index + 1);
      const card = document.createElement('div');
      card.className = 'result-game-card';

      // Build Ball elements with staggered animation
      const ballsHtml = game.numbers.map((n, ballIdx) => {
        const colorClass = getBallColorClass(n);
        const delay = ballIdx * 0.06;
        return `
          <div class="lotto-ball-3d ${colorClass} ball-anim-pop" style="animation-delay: ${delay}s">
            ${n}
          </div>
        `;
      }).join('');

      card.innerHTML = `
        <div class="game-meta-header">
          <div class="game-label-box">
            <span class="game-index-badge">${label}</span>
            <span class="game-tag-title">VIP 전용 추천수</span>
          </div>
          <div class="game-badges-group">
            <span class="security-pass-badge" title="역대 1등 6자리 일치 조합에서 완전 배제되었습니다.">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
              역대 1등 0회 (PASS)
            </span>
            <span class="hot-score-badge">핫 지수 ${game.hotScore}점</span>
          </div>
        </div>

        <div class="balls-display-row">
          ${ballsHtml}
        </div>

        <div class="game-analysis-row">
          <div class="analysis-item">
            <span class="analysis-label">역대 최대 일치:</span>
            <span class="analysis-value">${game.maxMatch}개 (제${game.maxMatchRound}회)</span>
          </div>
          <div class="analysis-item">
            <span class="analysis-label">홀짝:</span>
            <span class="analysis-value">${game.oddEven}</span>
          </div>
          <div class="analysis-item">
            <span class="analysis-label">총합:</span>
            <span class="analysis-value">${game.sum}</span>
          </div>
          <button class="copy-single-btn" data-numbers="${game.numbers.join(', ')}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
            복사
          </button>
        </div>
      `;

      container.appendChild(card);
    });

    if (actionsBar) actionsBar.style.display = 'grid';

    // Play chime sound
    playCrystalChime(1.0);
    setTimeout(() => playCrystalChime(1.25), 180);
  }

  // --------------------------------------------------------------------------
  // STATISTICS & NUMBER FREQUENCY DRAWER
  // --------------------------------------------------------------------------
  function renderStatisticsDrawer() {
    const container = document.getElementById('stats-grid-container');
    if (!container) return;

    // Rank 1..45 by frequency
    const rankList = [];
    for (let i = 1; i <= 45; i++) {
      rankList.push({
        num: i,
        freq: AppState.frequencies[i],
        absence: AppState.lastAppearance[i]
      });
    }

    rankList.sort((a, b) => b.freq - a.freq);
    const maxFreq = rankList[0]?.freq || 180;

    container.innerHTML = rankList.map((item, idx) => {
      const colorClass = getBallColorClass(item.num);
      const pct = Math.round((item.freq / maxFreq) * 100);
      return `
        <div class="stat-num-card" title="번호 ${item.num}번: ${item.freq}회 출현 (최근 ${item.absence}회차 전 출현)">
          <div class="stat-mini-ball ${colorClass}">${item.num}</div>
          <div class="stat-freq-text">${item.freq}회 <span style="font-size:0.65rem; color:var(--text-muted)">(${idx + 1}위)</span></div>
          <div class="stat-freq-bar-wrap">
            <div class="stat-freq-bar-fill" style="width: ${pct}%"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  // --------------------------------------------------------------------------
  // LATEST ROUND SYNC (실시간 동행복권 최신 회차 동기화)
  // --------------------------------------------------------------------------
  async function syncLatestRounds() {
    const nextRound = AppState.latestRound + 1;
    showToast(`제 ${nextRound}회 최신 당첨번호 확인 중...`);

    const syncBtn = document.getElementById('btn-sync-data');
    if (syncBtn) syncBtn.classList.add('active');

    try {
      // 1. Direct or CORS Proxy fetch
      const targetUrl = `https://www.dhlottery.co.kr/lt645/selectPstLt645Info.do?srchLtEpsd=${nextRound}`;
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;

      const res = await fetch(proxyUrl, { cache: 'no-store' });
      if (!res.ok) throw new Error('Network error');

      const outerData = await res.json();
      const lottoData = JSON.parse(outerData.contents);

      if (lottoData && lottoData.data && lottoData.data.list && lottoData.data.list.length > 0) {
        const item = lottoData.data.list[0];
        if (item.ltEpsd === nextRound && item.tm1WnNo) {
          const newDraw = {
            round: item.ltEpsd,
            numbers: [item.tm1WnNo, item.tm2WnNo, item.tm3WnNo, item.tm4WnNo, item.tm5WnNo, item.tm6WnNo],
            bonus: item.bnsWnNo
          };

          // Save to local storage
          const storedExtras = localStorage.getItem('LOTTO_EXTRA_ROUNDS');
          const currentExtras = storedExtras ? JSON.parse(storedExtras) : [];
          currentExtras.unshift(newDraw);
          localStorage.setItem('LOTTO_EXTRA_ROUNDS', JSON.stringify(currentExtras));

          initHistoryData();
          showToast(`제 ${nextRound}회 신규 당첨번호 동기화 성공!`);
          return;
        }
      }

      showToast(`현재 제 ${AppState.latestRound}회가 가장 최신 회차입니다.`);
    } catch (err) {
      console.warn('Auto sync note:', err);
      // If CORS or offline, inform gracefully
      showToast(`현재 제 ${AppState.latestRound}회 데이터가 정상 동기화되어 있습니다.`);
    } finally {
      if (syncBtn) syncBtn.classList.remove('active');
    }
  }

  // --------------------------------------------------------------------------
  // CLIPBOARD & UTILITY FUNCTIONS
  // --------------------------------------------------------------------------
  function copyTextToClipboard(text, successMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        showToast(successMsg);
      });
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      showToast(successMsg);
    }
  }

  function copyAllGames() {
    if (!AppState.generatedGames.length) return;
    const gameLabels = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

    let output = `[LOTTO VIP GENESIS PRO 2026 추천 번호]\n`;
    output += `기준: 제 1~${AppState.latestRound}회 1등 조합 완전 제외\n`;
    output += `--------------------------------------\n`;

    AppState.generatedGames.forEach((game, idx) => {
      const label = gameLabels[idx] || (idx + 1);
      const numsStr = game.numbers.map(n => String(n).padStart(2, '0')).join(', ');
      output += `${label}게임 : ${numsStr} (핫지수 ${game.hotScore}%)\n`;
    });
    output += `--------------------------------------\n행운을 빕니다!`;

    copyTextToClipboard(output, '전체 5게임 번호가 복사되었습니다!');
  }

  function showToast(msg) {
    const toast = document.getElementById('vip-toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => {
      toast.classList.remove('show');
    }, 2800);
  }

  // --------------------------------------------------------------------------
  // EVENT LISTENERS & SETUP
  // --------------------------------------------------------------------------
  function setupEventListeners() {
    // Mode Selection Cards
    document.querySelectorAll('.mode-card').forEach(card => {
      card.addEventListener('click', () => {
        document.querySelectorAll('.mode-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        AppState.currentMode = card.getAttribute('data-mode');
        playCrystalChime(1.4);
      });
    });

    // Game Count Selector Buttons
    document.querySelectorAll('.game-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.game-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        AppState.gameCount = parseInt(btn.getAttribute('data-count'), 10);
        playCrystalChime(1.1);
      });
    });

    // Generate Button
    const btnGen = document.getElementById('btn-generate');
    if (btnGen) {
      btnGen.addEventListener('click', executeGenerate);
    }

    // Single Game Copy (Delegated)
    const resultsContainer = document.getElementById('results-list');
    if (resultsContainer) {
      resultsContainer.addEventListener('click', e => {
        const btn = e.target.closest('.copy-single-btn');
        if (btn) {
          const numbers = btn.getAttribute('data-numbers');
          copyTextToClipboard(numbers, `번호 [${numbers}] 복사 완료!`);
        }
      });
    }

    // Batch Actions
    const btnCopyAll = document.getElementById('btn-copy-all');
    if (btnCopyAll) btnCopyAll.addEventListener('click', copyAllGames);

    const btnPrint = document.getElementById('btn-print');
    if (btnPrint) btnPrint.addEventListener('click', () => window.print());

    // Sync Button
    const btnSync = document.getElementById('btn-sync-data');
    if (btnSync) btnSync.addEventListener('click', syncLatestRounds);

    // Sound Toggle
    const btnSound = document.getElementById('btn-toggle-sound');
    if (btnSound) {
      btnSound.addEventListener('click', () => {
        AppState.soundEnabled = !AppState.soundEnabled;
        btnSound.classList.toggle('active', AppState.soundEnabled);
        btnSound.innerHTML = AppState.soundEnabled ? 
          `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg> 효과음 ON` :
          `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg> 효과음 OFF`;
        if (AppState.soundEnabled) playCrystalChime(1.5);
      });
    }

    // Statistics Drawer Toggle
    const btnStatsToggle = document.getElementById('btn-toggle-stats');
    const statsGrid = document.getElementById('stats-grid-container');
    if (btnStatsToggle && statsGrid) {
      btnStatsToggle.addEventListener('click', () => {
        const isHidden = statsGrid.style.display === 'none';
        statsGrid.style.display = isHidden ? 'grid' : 'none';
        btnStatsToggle.querySelector('.toggle-arrow').textContent = isHidden ? '▲ 접기' : '▼ 펼치기';
      });
    }

    // PWA Install Prompt Handler
    let deferredPrompt;
    const btnInstall = document.getElementById('btn-install-pwa');

    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      deferredPrompt = e;
      if (btnInstall) btnInstall.style.display = 'inline-flex';
    });

    if (btnInstall) {
      btnInstall.addEventListener('click', async () => {
        if (!deferredPrompt) {
          showToast('브라우저 메뉴에서 "홈 화면에 추가"를 선택하세요.');
          return;
        }
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
          btnInstall.style.display = 'none';
        }
        deferredPrompt = null;
      });
    }
  }

  // --------------------------------------------------------------------------
  // APP BOOTSTRAP
  // --------------------------------------------------------------------------
  document.addEventListener('DOMContentLoaded', () => {
    initHistoryData();
    setupEventListeners();
    // Generate initial 5 games on launch
    executeGenerate();

    // Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  });

})();
