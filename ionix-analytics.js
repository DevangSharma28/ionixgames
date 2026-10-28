/* ===========================================================
   IONIX — Analytics: consent banner + GA4 event tracking
   Needs the gtag snippet in each page's <head>.
=========================================================== */

(function () {

    if (typeof window.gtag !== 'function') return;

    var CONSENT_KEY = 'ix-consent';

    var sent = {};
    // once: send this event at most one time per page view (for spammable toys)
    window.ixTrack = function (name, params, once) {
        if (once) {
            if (sent[name]) return;
            sent[name] = true;
        }
        gtag('event', name, params || {});
    };
    var track = window.ixTrack;

    function getConsent() {
        try { return localStorage.getItem(CONSENT_KEY); } catch (e) { return null; }
    }

    function setConsent(val) {
        try { localStorage.setItem(CONSENT_KEY, val); } catch (e) {}
        gtag('consent', 'update', { analytics_storage: val });
    }

    /* ---------- Consent banner ---------- */
    // GA starts "denied" for EEA/UK/CH (by IP, set in <head>). We show the banner
    // to visitors whose time zone is in Europe, and to anyone via "Cookie settings".

    function inEurope() {
        try {
            var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
            return tz.indexOf('Europe/') === 0 || /^Atlantic\/(Reykjavik|Canary|Madeira|Azores|Faroe)$/.test(tz);
        } catch (e) { return false; }
    }

    var banner = null;

    function openBanner() {
        if (banner) return;
        banner = document.createElement('div');
        banner.className = 'ix-consent';
        banner.setAttribute('role', 'dialog');
        banner.setAttribute('aria-label', 'Cookie preferences');
        banner.innerHTML =
            '<p>We use Google Analytics cookies to see which pages and games people visit. No ads, and we never sell your data. <a href="privacy.html#website">Learn more</a></p>' +
            '<div class="ix-consent-actions">' +
            '<button type="button" class="btn btn-outline btn-small" data-consent="denied">Decline</button>' +
            '<button type="button" class="btn btn-green btn-small" data-consent="granted">Accept</button>' +
            '</div>';
        banner.addEventListener('click', function (e) {
            var b = e.target.closest('[data-consent]');
            if (!b) return;
            setConsent(b.getAttribute('data-consent'));
            banner.remove();
            banner = null;
        });
        document.body.appendChild(banner);
    }

    if (!getConsent() && inEurope()) openBanner();

    var footerText = document.querySelector('footer p');
    if (footerText) {
        var settings = document.createElement('a');
        settings.href = '#';
        settings.className = 'ix-consent-open';
        settings.textContent = 'Cookie settings';
        settings.addEventListener('click', function (e) {
            e.preventDefault();
            openBanner();
        });
        footerText.appendChild(document.createTextNode(' · '));
        footerText.appendChild(settings);
    }

    /* ---------- Link + button clicks ---------- */

    var GAMES = {
        'com.ionixgames.juicekingtycoon': 'Juice King Tycoon',
        'com.ionixgames.idlebakerycafe': 'Idle Bakery Cafe'
    };

    var SOCIAL = [
        ['instagram.com', 'instagram'],
        ['discord.gg', 'discord'],
        ['discord.com', 'discord'],
        ['youtube.com', 'youtube'],
        ['x.com', 'x'],
        ['twitter.com', 'x'],
        ['crazygames.com', 'crazygames']
    ];

    // Which part of the page a link sits in: navbar, footer, or the section id
    function linkLocation(el) {
        var s = el.closest('.navbar, footer, section[id]');
        if (!s) return 'page';
        if (s.classList.contains('navbar')) return 'navbar';
        if (s.tagName === 'FOOTER') return 'footer';
        return s.id;
    }

    function linkText(a) {
        var h = a.querySelector('h3');
        return ((h || a).textContent || '').replace(/[→›]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100);
    }

    document.addEventListener('click', function (e) {
        var a = e.target.closest && e.target.closest('a[href]');
        if (!a || a.classList.contains('ix-consent-open')) return;

        var where = linkLocation(a);

        if (a.hostname === 'play.google.com') {
            var id = (a.search.match(/[?&]id=([^&]+)/) || [])[1] || '';
            track('play_store_click', { game: GAMES[id] || id, link_location: where });
            return;
        }

        if (a.protocol === 'mailto:') {
            track('email_click', { link_location: where });
            return;
        }

        for (var i = 0; i < SOCIAL.length; i++) {
            if (a.hostname.indexOf(SOCIAL[i][0]) !== -1) {
                track('social_click', { platform: SOCIAL[i][1], link_location: where });
                return;
            }
        }

        // Placeholder links (e.g. Discord before the server exists) — measures demand
        if (a.getAttribute('href') === '#') {
            track('placeholder_click', { link_text: linkText(a), link_location: where });
            return;
        }

        if (a.hostname !== location.hostname) return; // other outbound links: GA's built-in "click" event

        if (where === 'navbar') {
            track('nav_click', { link_text: linkText(a), link_url: a.pathname });
        } else if (a.matches('.btn, .card, .ix-game, .ix-cta a')) {
            track('cta_click', { link_text: linkText(a), link_url: a.pathname, link_location: where });
        }
    });

    /* ---------- Site toys ---------- */

    document.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('.ix-pill-coin')) track('wallet_tap', {}, true);
    });

    /* ---------- Scroll depth (GA's built-in scroll event only covers 90%) ---------- */

    var marks = [25, 50, 75];
    function onScroll() {
        var h = document.documentElement;
        var max = h.scrollHeight - h.clientHeight;
        if (max <= 0) return;
        var pct = (h.scrollTop / max) * 100;
        while (marks.length && pct >= marks[0]) track('scroll_depth', { percent_scrolled: marks.shift() });
        if (!marks.length) document.removeEventListener('scroll', onScroll);
    }
    document.addEventListener('scroll', onScroll, { passive: true });

    /* ---------- 404 ---------- */

    if (document.body.getAttribute('data-ix-page') === '404') {
        track('page_not_found', { page_path: location.pathname, from_page: document.referrer || '(direct)' });
    }

})();
