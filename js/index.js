    // FIREBASE CONFIG
    const firebaseConfig = {
        apiKey: "AIzaSyBwhgcm1NSklD2ZlnWHfiyXeXBgAHoJUUY",
        authDomain: "moodelier-2025.firebaseapp.com",
        projectId: "moodelier-2025",
        storageBucket: "moodelier-2025.firebasestorage.app",
        messagingSenderId: "119446309058",
        appId: "1:119446309058:web:4cbf7a8e05866c678cd35b"
    };
    firebase.initializeApp(firebaseConfig);
    const auth = firebase.auth();
    const db = firebase.firestore();

    // stores mood entries locally after fetching from firestore
    let moodCache = {};
    let currentUser = null;

    // SETTINGS
    let YEAR = new Date().getFullYear();
    const MOOD_COLORS = ['#ff6b6b', '#ff9f43', '#feca57', '#48dbfb', '#1dd1a1']; // 1-5 index mapped 0-4
    const MOOD_LABELS = ['Terrible', 'Bad', 'Okay', 'Good', 'Excellent'];
    const EMOJIS = ['😊', '😄', '😋', '🥰', '😐', '☹️', '😠', '😴', '🤯', '✨'];
    const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    
    // tracking current state
    let currentSelection = { dateStr: null, dateObj: null };
    let currentLayout = 'grid'; // 'grid' | 'month' | 'timeline'
    let currentMonth = new Date().getMonth(); // 0 to 11 for month view
    let ignoringScrollUntil = 0; // timestamp to ignore scroll events (for programmatic scrolls)

    // UI refs
    const getScrollArea = () => document.getElementById('scrollArea');
    const getHeader = () => document.getElementById('appHeader');
    let cachedMonthCards = null; // cached for perf

    function isCurrentYearSelected() {
        return YEAR === new Date().getFullYear();
    }

    function getTodayDateStr() {
        return formatDate(new Date());
    }

    // LAYOUT STUFF
    function toggleLayout() {
        const layouts = ['grid', 'month', 'timeline'];
        const layoutIndex = layouts.indexOf(currentLayout);
        currentLayout = layouts[(layoutIndex + 1) % layouts.length];
        applyLayout();
    }

    function applyLayout() {
        const container = document.getElementById('calendar');
        const monthNav = document.getElementById('monthNav');
        const icon = document.getElementById('layoutIcon');

        // clear layout classes first
        container.classList.remove('month-view', 'timeline-view');
        monthNav.classList.remove('active');

        // swap icon depending on which view we're in
        const icons = {
            grid: '<path d="M3 3h8v8H3V3zm0 10h8v8H3v-8zm10-10h8v8h-8V3zm0 10h8v8h-8v-8z"/>',
            month: '<path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11zM7 11h5v5H7z"/>',
            timeline: '<path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/>'
        };
        icon.innerHTML = icons[currentLayout];

        if (currentLayout === 'month') {
            if (isCurrentYearSelected()) {
                currentMonth = new Date().getMonth();
            }
            container.classList.add('month-view');
            monthNav.classList.add('active');
            updateMonthView();
        } else if (currentLayout === 'timeline') {
            container.classList.add('timeline-view');
            // center the current date row when switching into timeline
            requestAnimationFrame(() => scrollToToday({ behavior: 'auto' }));
        }
    }

    function updateMonthView() {
        // use cached cards if available
        if (!cachedMonthCards || !cachedMonthCards.length) {
            cachedMonthCards = document.querySelectorAll('.month-card');
        }
        
        // remove active from current active card only (faster than iterating all)
        const prevActive = document.querySelector('.month-card.active-month');
        if (prevActive) prevActive.classList.remove('active-month');
        
        const activeCard = cachedMonthCards[currentMonth];
        if (activeCard) {
            activeCard.classList.add('active-month', 'in-view');
        }

        document.getElementById('navMonthLabel').textContent = `${MONTHS[currentMonth]} ${YEAR}`;
        document.getElementById('prevMonth').disabled = (currentMonth === 0);
        document.getElementById('nextMonth').disabled = (currentMonth === 11);
    }

    function navigateMonth(direction) {
        currentMonth += direction;
        if (currentMonth < 0) {
            currentMonth = 0;
        }
        if (currentMonth > 11) {
            currentMonth = 11;
        }
        updateMonthView();
    }

    // YEAR PICKER
    function changeYear() {
        const list = document.getElementById('yearList');
        const currentRealYear = new Date().getFullYear();
        
        // only rebuild the list if its empty, saves some perf
        if (!list.hasChildNodes()) {
            const fragment = document.createDocumentFragment();
            for (let year = currentRealYear; year >= 2025; year--) {
                const option = document.createElement('div');
                option.className = 'year-option';
                option.textContent = year;
                option.dataset.year = year;
                option.onclick = () => selectYear(year);
                fragment.appendChild(option);
            }
            list.appendChild(fragment);
        }
        
        // highlight the year thats currently active
        list.querySelectorAll('.year-option').forEach(element => {
            if (parseInt(element.dataset.year) === YEAR) {
                element.classList.add('selected');
            } else {
                element.classList.remove('selected');
            }
        });
        
        openModal('yearModal');
    }

    function selectYear(selectedYear) {
        YEAR = selectedYear;
        closeModal('yearModal');
        renderCalendar();
    }

    // ON PAGE LOAD
    document.addEventListener('DOMContentLoaded', () => {
        setupEmojiGrid();
        setupMoodSelectors();
        setupHeaderSizing();
        setupHeaderScrollBehavior();
        setupCalendarClickDelegation();
        
        // when user logs in or out
        auth.onAuthStateChanged(async user => {
            if (user) {
                // need to reload to get updated displayName
                await user.reload();
                currentUser = auth.currentUser;
                loadMoodData().then(() => renderCalendar());
            } else {
                currentUser = null;
                moodCache = {};
                renderCalendar();
            }
        });
    });

    // single event listener for all calendar/timeline clicks (better perf than 365+ individual handlers)
    function setupCalendarClickDelegation() {
        const container = document.getElementById('calendar');
        if (!container) return;
        
        container.addEventListener('click', (e) => {
            // find the clicked day-cell or timeline-entry
            const dayCell = e.target.closest('.day-cell');
            const timelineEntry = e.target.closest('.timeline-entry');
            const target = dayCell || timelineEntry;
            
            if (target && target.dataset.date) {
                handleDateClick(target.dataset.date);
            }
        });
    }

    // grabs all mood entries from firestore
    async function loadMoodData() {
        if (!currentUser) return;
        try {
            const snapshot = await db.collection('users').doc(currentUser.uid).collection('moods').get();
            moodCache = {};
            snapshot.forEach(doc => {
                moodCache[doc.id] = doc.data();
            });
        } catch (error) {
            console.error("Error loading mood data:", error);
        }
    }

    // CALENDAR RENDERING
    function renderCalendar() {
        const container = document.getElementById('calendar');
        container.innerHTML = '';
        cachedMonthCards = null; // clear cache on re-render

        const todayStr = getTodayDateStr();
        const shouldHighlightToday = isCurrentYearSelected();

        // using fragments here for better perf
        const fragment = document.createDocumentFragment();
        const timelineFragment = document.createDocumentFragment();

        MONTHS.forEach((month, index) => {
            const card = document.createElement('div');
            card.className = 'month-card';
            if (currentLayout === 'month' && index === currentMonth) {
                card.classList.add('active-month');
            }
            
            // days grid for this month
            const grid = document.createElement('div');
            grid.className = 'days-grid';
            
            // weekday headers
            ['S','M','T','W','T','F','S'].forEach(dayLetter => {
                const labelElement = document.createElement('div');
                labelElement.className = 'day-label';
                labelElement.innerText = dayLetter;
                grid.appendChild(labelElement);
            });

            const daysInMonth = new Date(YEAR, index + 1, 0).getDate();
            const firstDayIndex = new Date(YEAR, index, 1).getDay();

            // blank cells before the 1st
            for(let blankIndex = 0; blankIndex < firstDayIndex; blankIndex++) {
                grid.appendChild(document.createElement('div'));
            }

            // actual day cells
            for(let dayNumber = 1; dayNumber <= daysInMonth; dayNumber++) {
                const dateStr = `${YEAR}-${String(index+1).padStart(2,'0')}-${String(dayNumber).padStart(2,'0')}`;
                const cell = document.createElement('div');
                cell.className = 'day-cell';
                cell.dataset.date = dateStr;
                cell.innerHTML = `<span class="day-num">${dayNumber}</span>`;
                // onclick handled via event delegation

                // see if theres an entry for this day
                const entry = getEntry(dateStr);
                if(entry) {
                    cell.style.background = MOOD_COLORS[entry.level - 1];
                    cell.classList.add('filled');

                    // emoji shows on hover
                    if (entry.emoji) {
                        cell.classList.add('has-emoji');
                        cell.setAttribute('data-emoji', entry.emoji);
                    }
                } else if (shouldHighlightToday && dateStr === todayStr) {
                    // highlight only if it's today AND empty (no entry)
                    cell.classList.add('today');
                }

                grid.appendChild(cell);

                // also add a timeline item
                const tlEntry = createTimelineEntry(dateStr, entry, month, dayNumber);
                timelineFragment.appendChild(tlEntry);
            }

            const title = document.createElement('div');
            title.className = 'month-title';
            title.innerText = month;

            card.appendChild(title);
            card.appendChild(grid);
            fragment.appendChild(card);
        });

        // append everything at once to avoid reflows
        container.appendChild(fragment);
        container.appendChild(timelineFragment);

        // reapply the current layout
        applyLayout();

        // reveal month cards only when they scroll into view
        setupMonthCardReveal();

        // jump to today's position after refresh/render (all layouts)
        requestAnimationFrame(() => scrollToToday({ behavior: 'auto' }));
    }

    function scrollToToday({ behavior = 'auto' } = {}) {
        if (!isCurrentYearSelected()) return;
        const scrollArea = getScrollArea();
        if (!scrollArea) return;

        const todayStr = getTodayDateStr();

        // tell header scroll handler to ignore scroll events briefly
        ignoringScrollUntil = Date.now() + 150;

        if (currentLayout === 'month') {
            currentMonth = new Date().getMonth();
            updateMonthView();
        }

        if (currentLayout === 'timeline') {
            const row = scrollArea.querySelector(`.timeline-entry[data-date="${todayStr}"]`);
            if (row) {
                row.scrollIntoView({ block: 'center', behavior });
            }
            return;
        }

        const cell = scrollArea.querySelector(`.day-cell[data-date="${todayStr}"]`);
        if (cell) {
            cell.scrollIntoView({ block: 'center', behavior });
        }
    }

    // SCROLL REVEAL (month cards)
    function setupMonthCardReveal() {
        const cards = document.querySelectorAll('.month-card');
        if (!cards.length) return;

        // month view: only one card is visible; reveal it immediately
        if (currentLayout === 'month') {
            const activeCard = cards[currentMonth];
            if (activeCard) {
                activeCard.classList.add('in-view');
            }
            return;
        }

        // fallback: if IntersectionObserver isn't supported, reveal everything
        if (!('IntersectionObserver' in window)) {
            cards.forEach(card => card.classList.add('in-view'));
            return;
        }

        const observer = new IntersectionObserver(
            entries => {
                entries.forEach(entry => {
                    if (!entry.isIntersecting) return;
                    entry.target.classList.add('in-view');
                    observer.unobserve(entry.target);
                });
            },
            {
                threshold: 0.1,
                rootMargin: '50px 0px 50px 0px' // pre-reveal slightly before entering viewport
            }
        );

        cards.forEach(card => {
            // don't re-observe already revealed cards
            if (card.classList.contains('in-view')) return;
            observer.observe(card);
        });
    }

    // HEADER (fixed) sizing + scroll behavior
    function setupHeaderSizing() {
        const header = getHeader();
        if (!header) return;

        const update = () => {
            const height = header.offsetHeight || 0;
            document.documentElement.style.setProperty('--header-height', `${height}px`);
        };

        update();
        window.addEventListener('resize', update, { passive: true });
    }

    function setupHeaderScrollBehavior() {
        const header = getHeader();
        const scrollArea = getScrollArea();
        if (!header || !scrollArea) return;

        let lastTop = scrollArea.scrollTop;
        let ticking = false;

        const apply = (top) => {
            // ignore programmatic scrolls (e.g., scrollToToday)
            if (Date.now() < ignoringScrollUntil) {
                lastTop = top;
                return;
            }

            // always show when at the very top
            if (top <= 0) {
                header.classList.remove('is-hidden');
                header.classList.remove('scrolled');
                lastTop = top;
                return;
            }

            // mark as scrolled when not at top
            header.classList.add('scrolled');

            const delta = top - lastTop;
            // ignore tiny jitter
            if (Math.abs(delta) < 4) {
                lastTop = top;
                return;
            }

            // scrolling down hides, scrolling up reveals
            if (delta > 0) {
                header.classList.add('is-hidden');
            } else {
                header.classList.remove('is-hidden');
            }

            lastTop = top;
        };

        scrollArea.addEventListener('scroll', () => {
            const top = scrollArea.scrollTop;
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(() => {
                apply(top);
                ticking = false;
            });
        }, { passive: true });
    }

    // builds a single timeline row
    function createTimelineEntry(dateStr, entry, monthName, day) {
        const element = document.createElement('div');
        element.className = 'timeline-entry';
        element.dataset.date = dateStr;
        // onclick handled via event delegation

        const moodBox = document.createElement('div');
        moodBox.className = 'timeline-mood';
        
        if (entry) {
            moodBox.style.background = MOOD_COLORS[entry.level - 1];
            if (entry.emoji) {
                moodBox.textContent = entry.emoji;
            } else {
                moodBox.textContent = '';
            }
        } else {
            moodBox.classList.add('empty');
            moodBox.textContent = '?';
        }

        const info = document.createElement('div');
        info.className = 'timeline-info';

        const dateLabel = document.createElement('div');
        dateLabel.className = 'timeline-date';
        dateLabel.textContent = `${monthName} ${day}, ${YEAR}`;

        const noteElement = document.createElement('div');
        noteElement.className = 'timeline-note';
        if (entry && entry.note) {
            noteElement.textContent = entry.note;
        } else if (entry) {
            noteElement.textContent = 'No note';
        } else {
            noteElement.textContent = 'Not logged';
        }

        info.appendChild(dateLabel);
        info.appendChild(noteElement);

        element.appendChild(moodBox);
        element.appendChild(info);

        if (entry) {
            const levelBadge = document.createElement('div');
            levelBadge.className = 'timeline-level';
            levelBadge.textContent = MOOD_LABELS[entry.level - 1];
            levelBadge.style.color = MOOD_COLORS[entry.level - 1];
            element.appendChild(levelBadge);
        }

        return element;
    }

    // AUTH HELPERS
    function isLoggedIn() {
        return currentUser !== null;
    }

    function getCurrentUserData() {
        if (!currentUser) {
            return null;
        }
        let username = currentUser.displayName;
        if (!username) {
            username = currentUser.email.split('@')[0];
        }
        return {
            email: currentUser.email,
            username: username
        };
    }

    // PROFILE MODAL
    let isEditingProfile = false;

    function openProfile() {
        isEditingProfile = false;
        renderProfileContent();
        openModal('profileModal');
    }

    function renderProfileContent() {
        const content = document.getElementById('profileContent');
        
        if (isLoggedIn()) {
            const user = getCurrentUserData();
            
            if (isEditingProfile) {
                content.innerHTML = `
                    <div class="entry-view">
                        <div class="view-mood-icon">✏️</div>
                        <div class="form-group" style="margin-bottom: 15px;">
                            <input type="text" id="editUsername" class="glass-input" placeholder="Username" value="${user.username || ''}" style="width: 100%; text-align: center !important; padding-left: 15px;">
                        </div>
                        <div style="color: var(--text-muted); margin-bottom: 25px;">${user.email || ''}</div>
                        <div class="action-row" style="flex-direction: column; gap: 10px;">
                            <button class="glass-btn" style="width: 100%;" onclick="saveProfile()">Save Changes</button>
                            <button class="glass-btn btn-secondary" style="width: 100%;" onclick="isEditingProfile = false; renderProfileContent();">Cancel</button>
                        </div>
                    </div>
                `;
            } else {
                content.innerHTML = `
                    <div class="entry-view">
                        <div class="view-mood-icon">👤</div>
                        <div class="view-date" style="color: var(--text-main); font-size: 1.4rem; margin-bottom: 5px;">${user.username || 'User'}</div>
                        <div style="color: var(--text-muted); margin-bottom: 25px;">${user.email || ''}</div>
                        <div class="action-row" style="flex-direction: column; gap: 10px;">
                            <button class="glass-btn" style="width: 100%;" onclick="isEditingProfile = true; renderProfileContent();">Edit Profile</button>
                            <button class="glass-btn" style="width: 100%;" onclick="closeModal('profileModal'); openAnalytics();">View Insights</button>
                            <button class="glass-btn btn-secondary" style="width: 100%;" onclick="signOut()">Sign Out</button>
                        </div>
                    </div>
                `;
            }
        } else {
            content.innerHTML = `
                <div class="entry-view">
                    <div class="view-mood-icon">🔒</div>
                    <div class="view-date" style="color: var(--text-main); font-size: 1.2rem; margin-bottom: 10px;">Not Signed In</div>
                    <p style="color: var(--text-muted); margin-bottom: 25px; line-height: 1.5;">Sign in to save your mood data and access it across devices.</p>
                    <div class="action-row">
                        <button class="glass-btn" style="width: 100%;" onclick="window.location.href='auth.html'">Sign In</button>
                    </div>
                </div>
            `;
        }
    }

    function saveProfile() {
        const newUsername = document.getElementById('editUsername').value.trim();
        if (!newUsername) {
            alert("Username cannot be empty.");
            return;
        }

        currentUser.updateProfile({ displayName: newUsername })
            .then(() => {
                isEditingProfile = false;
                renderProfileContent();
            })
            .catch(error => {
                alert("Error updating profile: " + error.message);
            });
    }

    function signOut() {
        auth.signOut().then(() => {
            currentUser = null;
            moodCache = {};
            closeModal('profileModal');
            window.location.href = 'auth.html';
        });
    }

    // DATE CLICK HANDLING
    function handleDateClick(dateStr) {
        // redirect if not signed in
        if (!isLoggedIn()) {
            window.location.href = 'auth.html';
            return;
        }

        const entry = getEntry(dateStr);
        const checkDate = parseLocalDateNoon(dateStr);
        const today = new Date();
        today.setHours(12,0,0,0);

        currentSelection = { dateStr, dateObj: checkDate };

        // future date warning
        // skip if theres already an entry tho
        if (checkDate > today && !entry) {
            showWarning('future', dateStr);
            return;
        }

        // gap check, only if theres no entry for this day yet
        if (!entry) {
            const yesterday = new Date(checkDate);
            yesterday.setDate(yesterday.getDate() - 1);
            const yStr = formatDate(yesterday);
            
            // warn if yesterday doesnt have data
            if (yesterday.getFullYear() === YEAR && !getEntry(yStr) && yesterday.getDate() !== 0) {
                // jan 1st is fine, not checking prev year
                if (checkDate.getMonth() !== 0 || checkDate.getDate() !== 1) {
                    showWarning('gap', dateStr);
                    return;
                }
            }
        }

        openEntryModal(dateStr);
    }

    function showWarning(type, dateStr) {
        const modal = document.getElementById('warningModal');
        const title = document.getElementById('warningTitle');
        const msg = document.getElementById('warningMsg');
        const icon = document.getElementById('warningIcon');
        const btn = document.getElementById('warningProceedBtn');

        if (type === 'future') {
            title.innerText = "Future Date";
            msg.innerText = "You are trying to log a mood for the future. Are you a time traveler?";
            icon.innerText = "🔮";
        } else {
            title.innerText = "Gap Detected";
            msg.innerText = "You missed logging your mood yesterday. Consistent tracking provides better insights.";
            icon.innerText = "🧩";
        }

        btn.onclick = () => {
            closeModal('warningModal');
            openEntryModal(dateStr);
        };
        
        openModal('warningModal');
    }

    // ENTRY MODAL
    function openEntryModal(dateStr) {
        const entry = getEntry(dateStr);
        const displayDate = new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

        if (entry) {
            // show the view modal
            document.getElementById('viewDateTitle').innerText = displayDate;
            document.getElementById('viewMoodIcon').innerText = entry.emoji;
            document.getElementById('viewMoodLevel').innerText = MOOD_LABELS[entry.level - 1];
            document.getElementById('viewMoodLevel').style.color = MOOD_COLORS[entry.level - 1];
            if (entry.note) {
                document.getElementById('viewNote').innerText = entry.note;
            } else {
                document.getElementById('viewNote').innerText = "No reflection added.";
            }
            openModal('viewModal');
        } else {
            // new entry, open edit mode
            document.getElementById('editDateTitle').innerText = displayDate;
            prepareEditMode();
            openModal('editModal');
        }
    }

    function switchToEdit() {
        closeModal('viewModal');
        const displayDate = new Date(currentSelection.dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        document.getElementById('editDateTitle').innerText = displayDate;
        prepareEditMode(getEntry(currentSelection.dateStr));
        openModal('editModal');
    }

    function prepareEditMode(data = null) {
        // clear any previous selections
        document.querySelectorAll('.mood-opt').forEach(element => {
            element.classList.remove('selected');
        });
        document.querySelectorAll('.emoji-btn').forEach(element => {
            element.classList.remove('selected');
        });
        document.getElementById('noteInput').value = '';

        if (data) {
            // fill in with existing data
            const moodBtn = document.querySelector(`.mood-opt[data-level="${data.level}"]`);
            if (moodBtn) {
                moodBtn.classList.add('selected');
            }
            
            const emojiBtn = Array.from(document.querySelectorAll('.emoji-btn')).find(button => button.innerText === data.emoji);
            if (emojiBtn) {
                emojiBtn.classList.add('selected');
            }

            if (data.note) {
                document.getElementById('noteInput').value = data.note;
            } else {
                document.getElementById('noteInput').value = '';
            }
        }
    }

    function setupMoodSelectors() {
        document.querySelectorAll('.mood-opt').forEach(option => {
            option.onclick = function() {
                document.querySelectorAll('.mood-opt').forEach(element => {
                    element.classList.remove('selected');
                });
                this.classList.add('selected');
            }
        });
    }

    function setupEmojiGrid() {
        const grid = document.getElementById('emojiGrid');
        EMOJIS.forEach(emoji => {
            const button = document.createElement('button');
            button.className = 'emoji-btn';
            button.innerText = emoji;
            button.onclick = function() {
                document.querySelectorAll('.emoji-btn').forEach(element => {
                    element.classList.remove('selected');
                });
                this.classList.add('selected');
            };
            grid.appendChild(button);
        });
    }

    function saveEntry() {
        const levelElement = document.querySelector('.mood-opt.selected');
        const emojiElement = document.querySelector('.emoji-btn.selected');
        const note = document.getElementById('noteInput').value;

        if (!levelElement || !emojiElement) {
            alert("Please select a mood color and an emoji.");
            return;
        }

        const data = {
            level: parseInt(levelElement.getAttribute('data-level')),
            emoji: emojiElement.innerText,
            note: note.trim()
        };

        // save it
        if (currentUser) {
            db.collection('users').doc(currentUser.uid).collection('moods').doc(currentSelection.dateStr).set(data)
                .then(() => {
                    moodCache[currentSelection.dateStr] = data;
                    closeModal('editModal');
                    renderCalendar();
                })
                .catch(error => {
                    alert("Error saving: " + error.message);
                });
        }
    }

    function clearEntry() {
        if (!currentSelection.dateStr) return;
        
        // remove from db
        if (currentUser) {
            db.collection('users').doc(currentUser.uid).collection('moods').doc(currentSelection.dateStr).delete()
                .then(() => {
                    delete moodCache[currentSelection.dateStr];
                    closeModal('editModal');
                    renderCalendar();
                })
                .catch(error => {
                    alert("Error deleting: " + error.message);
                });
        }
    }

    // ANALYTICS
    function openAnalytics() {
        const entries = Object.entries(moodCache).map(([date, data]) => ({ date, ...data })).sort((a, b) => a.date.localeCompare(b.date));
        
        // basic stats
        document.getElementById('statTotal').innerText = entries.length;
        const totalScore = entries.reduce((acc, curr) => acc + curr.level, 0);
        let averageMood = 0;
        if (entries.length) {
            averageMood = (totalScore / entries.length).toFixed(1);
        }
        const avgElement = document.getElementById('statAvg');
        avgElement.innerText = averageMood;
        if (entries.length) {
            avgElement.style.color = MOOD_COLORS[Math.round(averageMood) - 1];
        }

        // last 30 days data
        const last30 = getLast30DaysEntries();

        // 30 day average
        const avg30Element = document.getElementById('stat30DayAvg');
        if (last30.length) {
            const avg30 = (last30.reduce((sum, entry) => sum + entry.level, 0) / last30.length).toFixed(1);
            avg30Element.innerText = avg30;
            avg30Element.style.color = MOOD_COLORS[Math.round(avg30) - 1];
        } else {
            avg30Element.innerText = '--';
            avg30Element.style.color = '';
        }

        // most used emoji lately
        renderTopEmoji(last30);

        // compare this month vs last month
        renderMonthComparison(entries);

        // trend line
        renderTrendGraph();

        // weekly pattern
        renderWeeklyChart(entries);

        // mood distribution
        renderDistribution(entries);

        // monthly averages chart
        renderMonthlyAverages(entries);

        openModal('analyticsModal');
    }

    function getLast30DaysEntries() {
        const today = new Date();
        const result = [];
        for (let dayOffset = 0; dayOffset < 30; dayOffset++) {
            const checkDate = new Date();
            checkDate.setDate(today.getDate() - dayOffset);
            const entry = getEntry(formatDate(checkDate));
            if (entry) {
                result.push(entry);
            }
        }
        return result;
    }

    function renderTopEmoji(entries) {
        const element = document.getElementById('statTopEmoji');
        if (!entries.length) {
            element.innerText = '--';
            return;
        }
        
        const counts = {};
        entries.forEach(entry => {
            if (entry.emoji) {
                if (counts[entry.emoji]) {
                    counts[entry.emoji] = counts[entry.emoji] + 1;
                } else {
                    counts[entry.emoji] = 1;
                }
            }
        });
        
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        if (sorted.length) {
            element.innerText = sorted[0][0];
        } else {
            element.innerText = '--';
        }
    }

    function renderMonthComparison(entries) {
        const element = document.getElementById('statMonthCompare');
        const labelElement = document.getElementById('statMonthLabel');
        
        const now = new Date();
        const thisMonth = now.getMonth();
        const thisYear = now.getFullYear();
        let lastMonth;
        let lastMonthYear;
        if (thisMonth === 0) {
            lastMonth = 11;
            lastMonthYear = thisYear - 1;
        } else {
            lastMonth = thisMonth - 1;
            lastMonthYear = thisYear;
        }
        
        const thisMonthEntries = entries.filter(entry => {
            const entryDate = new Date(entry.date + 'T12:00:00');
            return entryDate.getMonth() === thisMonth && entryDate.getFullYear() === thisYear;
        });
        
        const lastMonthEntries = entries.filter(entry => {
            const entryDate = new Date(entry.date + 'T12:00:00');
            return entryDate.getMonth() === lastMonth && entryDate.getFullYear() === lastMonthYear;
        });
        
        if (!thisMonthEntries.length || !lastMonthEntries.length) {
            element.innerText = '--';
            element.style.color = '';
            return;
        }
        
        const thisAvg = thisMonthEntries.reduce((sum, entry) => sum + entry.level, 0) / thisMonthEntries.length;
        const lastAvg = lastMonthEntries.reduce((sum, entry) => sum + entry.level, 0) / lastMonthEntries.length;
        const diff = thisAvg - lastAvg;
        
        if (Math.abs(diff) < 0.1) {
            element.innerText = '→ Same';
            element.style.color = 'var(--mood-3)';
        } else if (diff > 0) {
            element.innerText = `↑ +${diff.toFixed(1)}`;
            element.style.color = 'var(--mood-5)';
        } else {
            element.innerText = `↓ ${diff.toFixed(1)}`;
            element.style.color = 'var(--mood-1)';
        }
    }

    function renderMonthlyAverages(entries) {
        const container = document.getElementById('monthlyChart');
        container.innerHTML = '';
        
        const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const totals = new Array(12).fill(0);
        const counts = new Array(12).fill(0);
        
        entries.forEach(entry => {
            const entryDate = new Date(entry.date + 'T12:00:00');
            if (entryDate.getFullYear() === YEAR) {
                const monthIndex = entryDate.getMonth();
                totals[monthIndex] += entry.level;
                counts[monthIndex]++;
            }
        });
        
        monthNames.forEach((month, monthIndex) => {
            let avg = 0;
            if (counts[monthIndex]) {
                avg = totals[monthIndex] / counts[monthIndex];
            }
            const pct = (avg / 5) * 100;
            
            const col = document.createElement('div');
            col.className = 'bar-col';
            
            const bar = document.createElement('div');
            bar.className = 'bar';
            bar.style.height = `${pct}%`;
            if (avg > 0) {
                bar.style.background = MOOD_COLORS[Math.round(avg) - 1];
            }
            
            const label = document.createElement('div');
            label.className = 'bar-label';
            label.innerText = month;
            
            col.appendChild(bar);
            col.appendChild(label);
            container.appendChild(col);
        });
    }

    function renderTrendGraph() {
        const svg = document.getElementById('trendGraph');
        svg.innerHTML = '';
        const today = new Date();
        const points = [];
        
        // grab last 30 days, null if missing
        for (let dayIndex = 29; dayIndex >= 0; dayIndex--) {
            const loopDate = new Date();
            loopDate.setDate(today.getDate() - dayIndex);
            const dateString = formatDate(loopDate);
            const entry = getEntry(dateString);
            // null if no entry so the line just skips
            if (entry) {
                points.push(entry.level);
            } else {
                points.push(null);
            }
        }

        // build the line
        let pointsStr = "";
        const widthStep = 100 / 29;
        
        let polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
        polyline.classList.add('trend-line');
        
        let pathD = "";
        let hasStarted = false;

        points.forEach((value, index) => {
            if (value !== null) {
                const xPos = (index / 29) * 100 + "%";
                const yPos = (100 - ((value - 0.5) / 5) * 100) + "%";
                
                if (!hasStarted) {
                    pathD += `M ${xPos} ${yPos}`;
                    hasStarted = true;
                } else {
                    pathD += ` L ${xPos} ${yPos}`;
                }
                
                // dot for each data point
                const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
                circle.setAttribute("cx", xPos);
                circle.setAttribute("cy", yPos);
                circle.setAttribute("r", "3");
                circle.setAttribute("fill", MOOD_COLORS[value - 1]);
                svg.appendChild(circle);
            }
        });

        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", pathD);
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "rgba(255,255,255,0.5)");
        path.setAttribute("stroke-width", "2");
        svg.prepend(path);
    }

    function renderWeeklyChart(entries) {
        const container = document.getElementById('weeklyChart');
        container.innerHTML = '';
        
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const totals = new Array(7).fill(0);
        const counts = new Array(7).fill(0);

        entries.forEach(entry => {
            const dayOfWeek = new Date(entry.date).getDay();
            totals[dayOfWeek] += entry.level;
            counts[dayOfWeek]++;
        });

        days.forEach((day, dayIndex) => {
            let avg = 0;
            if (counts[dayIndex]) {
                avg = totals[dayIndex] / counts[dayIndex];
            }
            const pct = (avg / 5) * 100;

            const col = document.createElement('div');
            col.className = 'bar-col';
            
            const bar = document.createElement('div');
            bar.className = 'bar';
            bar.style.height = `${pct}%`;
            if (avg > 0) {
                bar.style.background = MOOD_COLORS[Math.round(avg) - 1];
            }

            const label = document.createElement('div');
            label.className = 'bar-label';
            label.innerText = day;

            col.appendChild(bar);
            col.appendChild(label);
            container.appendChild(col);
        });
    }

    function renderDistribution(entries) {
        const container = document.getElementById('distChart');
        container.innerHTML = '';
        const counts = [0, 0, 0, 0, 0];
        
        entries.forEach(entry => {
            counts[entry.level - 1]++;
        });
        const maxCount = Math.max(...counts, 1);

        counts.forEach((count, index) => {
            const row = document.createElement('div');
            row.className = 'dist-row';
            
            const label = document.createElement('div');
            label.className = 'dist-label';
            const shortLabel = ['terr', 'bad', 'ok', 'good', 'excel'][index];
            label.innerText = shortLabel;
            label.title = MOOD_LABELS[index];

            const track = document.createElement('div');
            track.className = 'dist-track';

            const fill = document.createElement('div');
            fill.className = 'dist-fill';
            fill.style.width = `${(count / maxCount) * 100}%`;
            fill.style.background = MOOD_COLORS[index];

            track.appendChild(fill);
            row.appendChild(label);
            row.appendChild(track);
            container.appendChild(row);
        });
    }

    function parseLocalDateNoon(dateStr) {
        const [year, month, day] = dateStr.split('-').map(Number);
        return new Date(year, month - 1, day, 12, 0, 0, 0);
    }

    // HELPERS
    function getEntry(dateStr) {
        if (moodCache[dateStr]) {
            return moodCache[dateStr];
        }
        return null;
    }

    function formatDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function openModal(id) {
        document.getElementById(id).classList.add('active');
    }

    function closeModal(id) {
        document.getElementById(id).classList.remove('active');
    }

    // clicking outside closes modal
    window.onclick = function(event) {
        if (event.target.classList.contains('modal-overlay')) {
            event.target.classList.remove('active');
        }
    }