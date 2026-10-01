// Global State
let allTransactions = [];
let filteredTransactions = [];
let leagueMap = {};
let seasonDataMap = {}; // season -> { users, rosters, rosterMap, userMap }
let currentLeague = null;
let currentView = 'cards'; // 'cards' | 'table'
let renderLimit = 100;
const PAGE_SIZE = 100;

// DOM Elements
const leagueIdInput = document.getElementById('leagueIdInput');
const loadBtn = document.getElementById('loadBtn');
const includePastSeasonsCheck = document.getElementById('includePastSeasonsCheck');
const statusMessage = document.getElementById('status-message');
const resultsContainer = document.getElementById('results');
const filterPanel = document.getElementById('filterPanel');
const statsGrid = document.getElementById('statsGrid');
const leagueInfoBanner = document.getElementById('leagueInfoBanner');
const loadMoreWrap = document.getElementById('loadMoreWrap');
const btnLoadMore = document.getElementById('btnLoadMore');
const resultsCount = document.getElementById('resultsCount');

// Filter elements
const playerSearchInput = document.getElementById('playerSearchInput');
const seasonSelect = document.getElementById('seasonSelect');
const weekSelect = document.getElementById('weekSelect');
const ownerSelect = document.getElementById('ownerSelect');
const typeSelect = document.getElementById('typeSelect');
const statusSelect = document.getElementById('statusSelect');
const sortSelect = document.getElementById('sortSelect');

// Event Listeners for Filters
playerSearchInput.addEventListener('input', debounce(applyFiltersAndRender, 200));
seasonSelect.addEventListener('change', applyFiltersAndRender);
weekSelect.addEventListener('change', applyFiltersAndRender);
ownerSelect.addEventListener('change', applyFiltersAndRender);
typeSelect.addEventListener('change', applyFiltersAndRender);
statusSelect.addEventListener('change', applyFiltersAndRender);
sortSelect.addEventListener('change', applyFiltersAndRender);

// Allow pressing Enter in input
leagueIdInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        loadTransactions();
    }
});

// Auto-check URL param or localStorage on load
window.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const paramLeagueId = urlParams.get('league') || urlParams.get('league_id');
    const savedLeagueId = localStorage.getItem('sleeper_league_id');

    if (paramLeagueId) {
        leagueIdInput.value = paramLeagueId.trim();
        loadTransactions();
    } else if (savedLeagueId) {
        leagueIdInput.value = savedLeagueId.trim();
    }
});

/**
 * Main function: loads league info, rosters, and all transactions
 */
async function loadTransactions() {
    const leagueId = leagueIdInput.value.trim();
    if (!leagueId) {
        alert('Please enter a Sleeper League ID');
        return;
    }

    // Save to localStorage
    localStorage.setItem('sleeper_league_id', leagueId);

    // Update URL without full reload
    const newUrl = new URL(window.location);
    newUrl.searchParams.set('league', leagueId);
    window.history.replaceState({}, '', newUrl);

    // Reset UI state
    loadBtn.disabled = true;
    resultsContainer.innerHTML = '';
    statsGrid.style.display = 'none';
    filterPanel.style.display = 'none';
    leagueInfoBanner.style.display = 'none';
    loadMoreWrap.style.display = 'none';
    allTransactions = [];
    seasonDataMap = {};
    renderLimit = PAGE_SIZE;

    showStatus('<p class="loader-text">[LOADING: Fetching league details...]</p>');

    try {
        // 1. Fetch root league details
        const leagueRes = await fetch(`https://api.sleeper.app/v1/league/${leagueId}`);
        if (!leagueRes.ok) {
            throw new Error(`League not found or invalid League ID: ${leagueId}`);
        }
        currentLeague = await leagueRes.json();
        if (!currentLeague || !currentLeague.league_id) {
            throw new Error('Invalid league data received from Sleeper.');
        }

        // 2. Discover past seasons if checked
        showStatus('<p class="loader-text">[LOADING: Resolving league seasons...]</p>');
        if (includePastSeasonsCheck.checked) {
            leagueMap = await getAllLeagueIds(leagueId);
        } else {
            leagueMap = { [currentLeague.season]: currentLeague.league_id };
        }

        const sortedSeasons = Object.keys(leagueMap).sort((a, b) => b - a);

        // 3. Display League Banner
        displayLeagueBanner(currentLeague, sortedSeasons);

        // 4. Fetch season data & transactions for each season
        for (let i = 0; i < sortedSeasons.length; i++) {
            const season = sortedSeasons[i];
            const sLeagueId = leagueMap[season];

            showStatus(
                `<p class="loader-text">[LOADING: Season ${season} (${i + 1}/${sortedSeasons.length})...]</p>`
            );

            const seasonTxs = await fetchSeasonTransactionsAndMetadata(season, sLeagueId);
            allTransactions.push(...seasonTxs);
        }

        if (allTransactions.length === 0) {
            showStatus('<p>No waiver or free agent transactions found for this league.</p>');
            loadBtn.disabled = false;
            return;
        }

        // 5. Populate Filter Controls
        populateFilterControls(sortedSeasons);

        // 6. Reveal panels
        hideStatus();
        leagueInfoBanner.style.display = 'flex';
        statsGrid.style.display = 'grid';
        filterPanel.style.display = 'block';

        // 7. Initial render
        applyFiltersAndRender();

    } catch (err) {
        console.error('Error loading transactions:', err);
        showStatus(`<p style="color: #ef4444; font-weight: 600;">Error: ${err.message || 'Failed to load league data.'}</p>`);
    } finally {
        loadBtn.disabled = false;
    }
}

/**
 * Traverses previous_league_id to discover all linked seasons
 */
async function getAllLeagueIds(startLeagueId) {
    const map = {};
    let currentId = startLeagueId;

    while (currentId) {
        try {
            const res = await fetch(`https://api.sleeper.app/v1/league/${currentId}`);
            if (!res.ok) break;
            const league = await res.json();
            if (!league || !league.season) break;
            map[league.season] = league.league_id;
            currentId = league.previous_league_id || null;
        } catch (e) {
            console.warn('Error following previous_league_id', e);
            break;
        }
    }

    return map;
}

/**
 * Calculates the NFL regular season kickoff timestamp for a given year.
 * Kickoff is always 8:00 PM ET on the first Thursday after the first Monday in September.
 */
function getNFLKickoffTimestamp(year) {
    const y = parseInt(year, 10);
    if (!y || isNaN(y)) return null;
    const d = new Date(Date.UTC(y, 8, 1));
    const day = d.getUTCDay();
    const firstMonday = 1 + ((8 - day) % 7);
    const kickoffDay = firstMonday + 3;
    return Date.UTC(y, 8, kickoffDay, 20, 0, 0); // 8:00 PM ET kickoff Thursday
}

/**
 * Fetches users, rosters, and transactions for weeks 0 through 18 concurrently
 */
async function fetchSeasonTransactionsAndMetadata(season, sLeagueId) {
    try {
        // Concurrently fetch users, rosters, and weeks 0-18 of transactions
        const weekCalls = Array.from({ length: 19 }, (_, idx) => {
            const week = idx; // 0 to 18
            return fetch(`https://api.sleeper.app/v1/league/${sLeagueId}/transactions/${week}`)
                .then(r => (r.ok ? r.json() : []))
                .then(txs => (Array.isArray(txs) ? txs : []).map(t => ({ ...t, season, week })))
                .catch(err => {
                    console.warn(`Failed week ${week} in ${season}`, err);
                    return [];
                });
        });

        const [usersRes, rostersRes, ...allWeekResults] = await Promise.all([
            fetch(`https://api.sleeper.app/v1/league/${sLeagueId}/users`).then(r => (r.ok ? r.json() : [])).catch(() => []),
            fetch(`https://api.sleeper.app/v1/league/${sLeagueId}/rosters`).then(r => (r.ok ? r.json() : [])).catch(() => []),
            ...weekCalls
        ]);

        // Build User Map: user_id -> { displayName, teamName, avatar }
        const userMap = {};
        usersRes.forEach(u => {
            userMap[u.user_id] = {
                displayName: u.display_name || 'Unknown',
                teamName: u.metadata?.team_name || u.display_name || 'Team ' + u.user_id,
                avatar: u.avatar
            };
        });

        // Build Roster Map: roster_id -> { displayName, teamName, ownerId }
        const rosterMap = {};
        rostersRes.forEach(r => {
            const ownerInfo = userMap[r.owner_id];
            rosterMap[r.roster_id] = {
                displayName: ownerInfo?.displayName || 'Unknown Manager',
                teamName: ownerInfo?.teamName || `Team #${r.roster_id}`,
                ownerId: r.owner_id
            };
        });

        seasonDataMap[season] = { users: usersRes, rosters: rostersRes, userMap, rosterMap };

        // Flatten weeks and filter for waiver & free_agent activity
        const rawTxs = allWeekResults.flat();
        const relevantTxs = rawTxs.filter(t => t.type === 'waiver' || t.type === 'free_agent');

        // Normalize each transaction
        return relevantTxs.map(t => normalizeTransaction(t, season, rosterMap, userMap));

    } catch (err) {
        console.warn(`Failed loading data for season ${season}`, err);
        return [];
    }
}

/**
 * Normalizes a Sleeper transaction into a clean, structured object
 */
function normalizeTransaction(t, season, rosterMap, userMap) {
    const addsList = t.adds ? Object.entries(t.adds).map(([pid, rid]) => ({
        playerId: pid,
        rosterId: rid,
        player: getPlayerInfo(pid)
    })) : [];

    const dropsList = t.drops ? Object.entries(t.drops).map(([pid, rid]) => ({
        playerId: pid,
        rosterId: rid,
        player: getPlayerInfo(pid)
    })) : [];

    // Determine involved roster ID
    const primaryRosterId =
        (addsList.length > 0 && addsList[0].rosterId) ||
        (dropsList.length > 0 && dropsList[0].rosterId) ||
        (t.roster_ids && t.roster_ids[0]) ||
        (t.consenter_ids && t.consenter_ids[0]) ||
        null;

    const ownerInfo = rosterMap[primaryRosterId] ||
        userMap[t.creator] || {
            displayName: 'Unknown Manager',
            teamName: primaryRosterId ? `Team #${primaryRosterId}` : 'Unknown Team'
        };

    const isWaiver = t.type === 'waiver';
    const isPureDrop = !isWaiver && addsList.length === 0 && dropsList.length > 0;

    let actionCategory = 'free_agent';
    if (isWaiver) actionCategory = 'waiver';
    else if (isPureDrop) actionCategory = 'drop';

    const timestamp = t.status_updated || t.created || 0;
    const bid = t.settings && typeof t.settings.waiver_bid !== 'undefined' ? Number(t.settings.waiver_bid) : null;
    const priority = t.settings && typeof t.settings.priority !== 'undefined' ? Number(t.settings.priority) : null;

    // Detect Offseason
    const rawWeek = (t.leg !== undefined && t.leg !== null) ? Number(t.leg) : (t.week !== undefined && t.week !== null ? Number(t.week) : 1);
    const kickoffTs = getNFLKickoffTimestamp(season);
    const isOffseason = rawWeek === 0 || (rawWeek === 1 && kickoffTs && timestamp < kickoffTs);
    const weekDisplay = isOffseason ? 'Offseason' : `Week ${rawWeek}`;
    const weekValue = isOffseason ? 'offseason' : String(rawWeek);

    // Filter out redundant generic success notes
    let notes = t.metadata?.notes || null;
    if (notes && /processed successfully/i.test(notes)) {
        notes = null;
    }

    return {
        id: t.transaction_id,
        raw: t,
        type: t.type,
        actionCategory, // 'waiver' | 'free_agent' | 'drop'
        status: t.status || 'complete', // 'complete' | 'failed'
        season: String(season),
        week: rawWeek,
        isOffseason,
        weekDisplay,
        weekValue,
        timestamp,
        dateFormatted: formatDate(timestamp),
        ownerInfo,
        primaryRosterId,
        adds: addsList,
        drops: dropsList,
        bid,
        priority,
        notes
    };
}

/**
 * Looks up player details from the global `window.players` database
 */
function getPlayerInfo(playerId) {
    if (!playerId) return null;
    const p = (typeof window.players !== 'undefined' && window.players) ? window.players[playerId] : null;

    if (!p) {
        return {
            id: playerId,
            name: `Player ${playerId}`,
            pos: '',
            team: '',
            posTeam: '',
            fullNameWithMeta: `Player ${playerId}`
        };
    }

    const name = p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || `Player ${playerId}`;
    const pos = p.position || (p.fantasy_positions && p.fantasy_positions[0]) || '';
    const team = p.team || '';
    const posTeam = [pos, team].filter(Boolean).join(' - ');

    return {
        id: playerId,
        name,
        pos,
        team,
        posTeam,
        fullNameWithMeta: posTeam ? `${name} (${posTeam})` : name
    };
}

/**
 * Formats a UNIX timestamp into a human readable date/time
 */
function formatDate(ts) {
    if (!ts) return 'Unknown Date';
    const d = new Date(ts);
    return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

/**
 * Displays header banner with league details
 */
function displayLeagueBanner(league, seasons) {
    document.getElementById('leagueNameDisplay').textContent = league.name || 'Sleeper League';
    const teamCount = league.total_rosters || 12;
    document.getElementById('leagueSubDisplay').textContent =
        `Season ${league.season} · ${teamCount} Teams · ${seasons.length} Season${seasons.length > 1 ? 's' : ''} loaded`;

    const badgeContainer = document.getElementById('leagueSettingBadge');
    let waiverTypeLabel = 'Waivers';
    if (league.settings?.waiver_type === 2) {
        const budget = league.settings?.waiver_budget || 100;
        waiverTypeLabel = `FAAB ($${budget})`;
    } else if (league.settings?.waiver_type === 1) {
        waiverTypeLabel = 'Rolling Waivers';
    } else if (league.settings?.waiver_type === 0) {
        waiverTypeLabel = 'Reverse Standings';
    }

    badgeContainer.innerHTML = `<span class="badge badge-filled">Type: ${escapeHtml(waiverTypeLabel)}</span>`;
}

/**
 * Populates dropdown select options for seasons, weeks, and owners
 */
function populateFilterControls(seasons) {
    // Populate Season dropdown
    seasonSelect.innerHTML = '<option value="">All Seasons</option>';
    seasons.forEach(s => {
        seasonSelect.innerHTML += `<option value="${s}">${s}</option>`;
    });

    // Automatically select 2026 if available, otherwise latest season
    if (seasons.includes('2026')) {
        seasonSelect.value = '2026';
    } else if (seasons.length > 0) {
        seasonSelect.value = seasons[0];
    }

    // Populate Week dropdown with Offseason as distinct option
    weekSelect.innerHTML = `
        <option value="">All Weeks</option>
        <option value="offseason">Offseason</option>
    `;
    for (let w = 1; w <= 18; w++) {
        weekSelect.innerHTML += `<option value="${w}">Week ${w}</option>`;
    }

    // Populate Owner dropdown (combine unique owners across all loaded seasons)
    const ownersMap = new Map();
    Object.values(seasonDataMap).forEach(sData => {
        if (sData.rosterMap) {
            Object.values(sData.rosterMap).forEach(r => {
                if (r.displayName && r.displayName !== 'Unknown Manager') {
                    ownersMap.set(r.displayName, r.teamName);
                }
            });
        }
    });

    ownerSelect.innerHTML = '<option value="">All Owners / Teams</option>';
    const sortedOwners = Array.from(ownersMap.entries()).sort((a, b) => a[1].localeCompare(b[1]));
    sortedOwners.forEach(([displayName, teamName]) => {
        ownerSelect.innerHTML += `<option value="${escapeHtml(displayName)}">${escapeHtml(teamName)} (${escapeHtml(displayName)})</option>`;
    });
}

/**
 * Filter, sort, and render transactions
 */
function applyFiltersAndRender() {
    const searchQuery = playerSearchInput.value.trim().toLowerCase();
    const selectedSeason = seasonSelect.value;
    const selectedWeek = weekSelect.value;
    const selectedOwner = ownerSelect.value;
    const selectedType = typeSelect.value;
    const selectedStatus = statusSelect.value;
    const selectedSort = sortSelect.value;

    filteredTransactions = allTransactions.filter(t => {
        // Season filter
        if (selectedSeason && t.season !== selectedSeason) return false;

        // Week filter (supports "offseason" and individual weeks 1-18)
        if (selectedWeek) {
            if (selectedWeek === 'offseason') {
                if (!t.isOffseason) return false;
            } else {
                if (t.isOffseason || String(t.week) !== selectedWeek) return false;
            }
        }

        // Owner filter
        if (selectedOwner && t.ownerInfo?.displayName !== selectedOwner) return false;

        // Action Type filter
        if (selectedType) {
            if (selectedType === 'waiver' && t.actionCategory !== 'waiver') return false;
            if (selectedType === 'free_agent' && t.actionCategory !== 'free_agent') return false;
            if (selectedType === 'drop' && t.actionCategory !== 'drop') return false;
        }

        // Status filter
        if (selectedStatus && t.status !== selectedStatus) return false;

        // Search query (player name, position, team, owner, or team name)
        if (searchQuery) {
            const matchesOwner =
                (t.ownerInfo.teamName && t.ownerInfo.teamName.toLowerCase().includes(searchQuery)) ||
                (t.ownerInfo.displayName && t.ownerInfo.displayName.toLowerCase().includes(searchQuery));

            const matchesAdd = t.adds.some(a =>
                a.player.name.toLowerCase().includes(searchQuery) ||
                a.player.pos.toLowerCase().includes(searchQuery) ||
                a.player.team.toLowerCase().includes(searchQuery)
            );

            const matchesDrop = t.drops.some(d =>
                d.player.name.toLowerCase().includes(searchQuery) ||
                d.player.pos.toLowerCase().includes(searchQuery) ||
                d.player.team.toLowerCase().includes(searchQuery)
            );

            if (!matchesOwner && !matchesAdd && !matchesDrop) return false;
        }

        return true;
    });

    // Sort transactions
    filteredTransactions.sort((a, b) => {
        if (selectedSort === 'newest') {
            return b.timestamp - a.timestamp;
        } else if (selectedSort === 'oldest') {
            return a.timestamp - b.timestamp;
        } else if (selectedSort === 'highest_bid') {
            const bidA = a.bid || 0;
            const bidB = b.bid || 0;
            if (bidB !== bidA) return bidB - bidA;
            return b.timestamp - a.timestamp;
        }
        return b.timestamp - a.timestamp;
    });

    // Update Statistics
    updateStats(filteredTransactions);

    // Reset pagination to first page
    renderLimit = PAGE_SIZE;

    // Render results
    renderResults();
}

/**
 * Computes and displays dynamic statistics
 */
function updateStats(txs) {
    let totalMoves = txs.length;
    let waiverCount = 0;
    let waiverSuccess = 0;
    let waiverFailed = 0;
    let faCount = 0;
    let dropCount = 0;
    let totalFaab = 0;
    let maxBid = 0;

    txs.forEach(t => {
        if (t.actionCategory === 'waiver') {
            waiverCount++;
            if (t.status === 'complete') waiverSuccess++;
            else waiverFailed++;

            if (t.bid !== null && t.bid > 0 && t.status === 'complete') {
                totalFaab += t.bid;
            }
        } else if (t.actionCategory === 'free_agent') {
            faCount++;
        }

        if (t.drops.length > 0) {
            dropCount += t.drops.length;
        }

        if (t.bid !== null && t.bid > maxBid) {
            maxBid = t.bid;
        }
    });

    document.getElementById('statTotal').textContent = totalMoves.toLocaleString();
    document.getElementById('statWaivers').textContent = `${waiverSuccess} / ${waiverCount}`;
    document.getElementById('statFA').textContent = faCount.toLocaleString();
    document.getElementById('statDrops').textContent = dropCount.toLocaleString();
    document.getElementById('statFaab').textContent = `$${totalFaab.toLocaleString()}`;
    document.getElementById('statMaxBid').textContent = `$${maxBid.toLocaleString()}`;
}

/**
 * Renders transactions according to current view mode (cards or table)
 */
function renderResults() {
    resultsContainer.innerHTML = '';
    const total = filteredTransactions.length;

    if (total === 0) {
        resultsCount.textContent = 'Showing 0 transactions';
        resultsContainer.innerHTML = `
            <div style="text-align: center; padding: 40px; background: #fff; border-radius: 10px; border: 1px solid var(--border);">
                <p style="font-size: 1.1rem; color: var(--text-muted); margin: 0 0 10px;">No transactions match the selected filters.</p>
                <button class="btn-primary" onclick="resetFilters()">Reset All Filters</button>
            </div>
        `;
        loadMoreWrap.style.display = 'none';
        return;
    }

    const itemsToRender = filteredTransactions.slice(0, renderLimit);
    resultsCount.textContent = `Showing ${itemsToRender.length.toLocaleString()} of ${total.toLocaleString()} transactions`;

    if (currentView === 'cards') {
        renderCardView(itemsToRender);
    } else {
        renderTableView(itemsToRender);
    }

    // Toggle Load More button
    if (renderLimit < total) {
        loadMoreWrap.style.display = 'block';
        btnLoadMore.textContent = `Show More (${(total - renderLimit).toLocaleString()} remaining)`;
    } else {
        loadMoreWrap.style.display = 'none';
    }
}

/**
 * Increments page limit and renders more items
 */
function loadMore() {
    renderLimit += PAGE_SIZE;
    renderResults();
}

/**
 * Renders Card View
 */
function renderCardView(items) {
    const list = document.createElement('div');
    list.className = 'tx-list';

    items.forEach((t, idx) => {
        const isFailed = t.status === 'failed';
        const card = document.createElement('article');
        card.className = `tx-card ${isFailed ? 'tx-failed' : 'tx-success'}`;

        // Type badge
        let typeBadge = '';
        if (t.actionCategory === 'waiver') {
            typeBadge = '<span class="badge">Waiver</span>';
        } else if (t.actionCategory === 'drop') {
            typeBadge = '<span class="badge">Drop</span>';
        } else {
            typeBadge = '<span class="badge">FA Pickup</span>';
        }

        // Status badge
        const statusBadge = isFailed
            ? '<span class="badge badge-failed">Failed</span>'
            : '<span class="badge badge-complete">Complete</span>';

        // FAAB bid badge
        let bidBadge = '';
        if (t.bid !== null) {
            bidBadge = `<span class="badge badge-bid">$${t.bid} FAAB</span>`;
        } else if (t.priority !== null && t.actionCategory === 'waiver') {
            bidBadge = `<span class="badge badge-bid">Priority #${t.priority}</span>`;
        }

        // Players HTML
        let playersHtml = '';
        if (t.adds.length > 0) {
            t.adds.forEach(add => {
                const posClass = (add.player.pos || '').toLowerCase();
                playersHtml += `
                    <div class="tx-player-row">
                        <span class="action-indicator indicator-add">+ ADD</span>
                        <div class="player-info-wrap">
                            <span class="player-name">${escapeHtml(add.player.name)}</span>
                            ${add.player.pos ? `<span class="badge-pos ${posClass}">${escapeHtml(add.player.pos)}</span>` : ''}
                            ${add.player.team ? `<span class="player-meta">${escapeHtml(add.player.team)}</span>` : ''}
                        </div>
                    </div>
                `;
            });
        }

        if (t.drops.length > 0) {
            t.drops.forEach(drop => {
                const posClass = (drop.player.pos || '').toLowerCase();
                playersHtml += `
                    <div class="tx-player-row">
                        <span class="action-indicator indicator-drop">- DROP</span>
                        <div class="player-info-wrap">
                            <span class="player-name">${escapeHtml(drop.player.name)}</span>
                            ${drop.player.pos ? `<span class="badge-pos ${posClass}">${escapeHtml(drop.player.pos)}</span>` : ''}
                            ${drop.player.team ? `<span class="player-meta">${escapeHtml(drop.player.team)}</span>` : ''}
                        </div>
                    </div>
                `;
            });
        }

        // Notes / failure reason
        let noteHtml = '';
        if (t.notes) {
            const noteClass = isFailed ? 'tx-note-failed' : 'tx-note-success';
            const notePrefix = isFailed ? 'Failure Reason:' : 'Note:';
            noteHtml = `
                <div class="tx-note-box ${noteClass}">
                    <span class="tx-note-prefix">${notePrefix}</span>
                    <span>${escapeHtml(t.notes)}</span>
                </div>
            `;
        }

        card.innerHTML = `
            <div class="tx-header">
                <div class="tx-header-left">
                    <span class="badge" style="background: var(--subtle-bg);">Season ${t.season} · ${t.weekDisplay}</span>
                    ${typeBadge}
                    ${statusBadge}
                    ${bidBadge}
                </div>
                <div class="tx-time">${t.dateFormatted}</div>
            </div>

            <div class="tx-team-info">
                <span class="team-name">${escapeHtml(t.ownerInfo.teamName)}</span>
                <span class="owner-name">(@${escapeHtml(t.ownerInfo.displayName)})</span>
            </div>

            <div class="tx-players-block">
                ${playersHtml}
            </div>

            ${noteHtml}

            <div class="tx-footer">
                <button class="btn-json" onclick="toggleJson('json-card-${idx}')">JSON</button>
            </div>
            <pre id="json-card-${idx}" class="json-pre">${escapeHtml(JSON.stringify(t.raw, null, 2))}</pre>
        `;

        list.appendChild(card);
    });

    resultsContainer.appendChild(list);
}

/**
 * Renders Table View
 */
function renderTableView(items) {
    const wrap = document.createElement('div');
    wrap.className = 'table-responsive';

    let rowsHtml = '';
    items.forEach((t, idx) => {
        const isFailed = t.status === 'failed';

        // Type
        let typeBadge = '';
        if (t.actionCategory === 'waiver') {
            typeBadge = '<span class="badge">Waiver</span>';
        } else if (t.actionCategory === 'drop') {
            typeBadge = '<span class="badge">Drop</span>';
        } else {
            typeBadge = '<span class="badge">FA</span>';
        }

        // Status
        const statusBadge = isFailed
            ? '<span class="badge badge-failed">Failed</span>'
            : '<span class="badge badge-complete">Complete</span>';

        // Added Players
        let addedStr = '-';
        if (t.adds.length > 0) {
            addedStr = t.adds.map(a => `<span style="color: var(--add-text); font-weight: 600;">+ ${escapeHtml(a.player.fullNameWithMeta)}</span>`).join('<br>');
        }

        // Dropped Players
        let droppedStr = '-';
        if (t.drops.length > 0) {
            droppedStr = t.drops.map(d => `<span style="color: var(--drop-text); font-weight: 600;">- ${escapeHtml(d.player.fullNameWithMeta)}</span>`).join('<br>');
        }

        // Bid / Cost
        let bidStr = '-';
        if (t.bid !== null) {
            bidStr = `<span class="badge badge-bid">$${t.bid}</span>`;
        } else if (t.priority !== null && t.actionCategory === 'waiver') {
            bidStr = `#${t.priority}`;
        }

        // Details / Notes
        const noteColor = isFailed ? 'var(--failed-text)' : 'var(--text-muted)';
        const details = t.notes ? `<span style="font-size: 0.78rem; color: ${noteColor};">${escapeHtml(t.notes)}</span>` : '-';

        rowsHtml += `
            <tr class="${isFailed ? 'tx-row-failed' : ''}">
                <td style="white-space: nowrap; font-family: monospace; font-size: 0.78rem; color: var(--text-muted);">${t.dateFormatted}</td>
                <td style="font-weight: 700; font-family: monospace; white-space: nowrap;">${t.season} ${t.isOffseason ? 'Offseason' : 'W' + t.week}</td>
                <td>${typeBadge}</td>
                <td>${statusBadge}</td>
                <td>
                    <div style="font-weight: 600;">${escapeHtml(t.ownerInfo.teamName)}</div>
                    <div style="font-size: 0.78rem; color: var(--text-muted);">${escapeHtml(t.ownerInfo.displayName)}</div>
                </td>
                <td class="cell-player">${addedStr}</td>
                <td class="cell-player">${droppedStr}</td>
                <td style="text-align: center;">${bidStr}</td>
                <td>${details}</td>
            </tr>
        `;
    });

    wrap.innerHTML = `
        <table class="tx-table">
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Season/Wk</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Team / Owner</th>
                    <th>Added</th>
                    <th>Dropped</th>
                    <th>Bid</th>
                    <th>Notes</th>
                </tr>
            </thead>
            <tbody>
                ${rowsHtml}
            </tbody>
        </table>
    `;

    resultsContainer.appendChild(wrap);
}

/**
 * Switches between 'cards' and 'table' view
 */
function switchView(view) {
    currentView = view;
    document.getElementById('btnCardsView').classList.toggle('active', view === 'cards');
    document.getElementById('btnTableView').classList.toggle('active', view === 'table');
    renderResults();
}

/**
 * Resets all search filters back to default
 */
function resetFilters() {
    playerSearchInput.value = '';
    if (seasonSelect.querySelector('option[value="2026"]')) {
        seasonSelect.value = '2026';
    } else {
        seasonSelect.value = '';
    }
    weekSelect.value = '';
    ownerSelect.value = '';
    typeSelect.value = '';
    statusSelect.value = '';
    sortSelect.value = 'newest';
    applyFiltersAndRender();
}

/**
 * Toggles visibility of raw JSON block
 */
function toggleJson(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = el.style.display === 'block' ? 'none' : 'block';
}

/**
 * Helper: Shows message in status container
 */
function showStatus(html) {
    statusMessage.style.display = 'block';
    statusMessage.innerHTML = html;
}

/**
 * Helper: Hides status container
 */
function hideStatus() {
    statusMessage.style.display = 'none';
}

/**
 * Helper: Escapes HTML to prevent XSS
 */
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Debounce helper for instant search typing
 */
function debounce(fn, delay) {
    let timer = null;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

/**
 * Exports currently filtered transactions as human-friendly JSON with player and team names
 */
function downloadFriendlyJson() {
    if (!filteredTransactions || filteredTransactions.length === 0) {
        alert('No transactions to download for the current filters.');
        return;
    }

    const friendlyData = filteredTransactions.map(t => {
        let actionLabel = 'Free Agent Pickup';
        if (t.actionCategory === 'waiver') {
            actionLabel = 'Waiver Claim';
        } else if (t.actionCategory === 'drop') {
            actionLabel = 'Player Drop';
        }

        return {
            transaction_id: t.id,
            date: t.timestamp ? new Date(t.timestamp).toISOString() : null,
            date_formatted: t.dateFormatted,
            season: t.season,
            week: t.week,
            period: t.weekDisplay,
            is_offseason: Boolean(t.isOffseason),
            type: t.type,
            action: actionLabel,
            status: t.status,
            team_name: t.ownerInfo?.teamName || 'Unknown Team',
            manager: t.ownerInfo?.displayName || 'Unknown Manager',
            faab_bid: t.bid,
            priority: t.priority,
            added_players: t.adds.map(a => ({
                name: a.player.name,
                position: a.player.pos || null,
                nfl_team: a.player.team || null,
                player_id: a.playerId
            })),
            dropped_players: t.drops.map(d => ({
                name: d.player.name,
                position: d.player.pos || null,
                nfl_team: d.player.team || null,
                player_id: d.playerId
            })),
            failure_reason: t.status === 'failed' ? (t.notes || null) : null
        };
    });

    // Build descriptive filename based on active filters
    const nameParts = ['sleeper', 'transactions'];
    if (seasonSelect.value) nameParts.push(seasonSelect.value);
    if (weekSelect.value) nameParts.push(weekSelect.value);
    if (typeSelect.value) nameParts.push(typeSelect.value);
    if (statusSelect.value) nameParts.push(statusSelect.value);
    if (ownerSelect.value) {
        const sanitizedOwner = ownerSelect.value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 20);
        nameParts.push(sanitizedOwner);
    }
    const filename = `${nameParts.join('_')}.json`;

    const jsonStr = JSON.stringify(friendlyData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
