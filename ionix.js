/* ===========================================================
   IONIX — "Tycoon" brand effects (shared across pages)
=========================================================== */

(function () {

    var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function store(key, val) {
        try {
            if (val === undefined) return localStorage.getItem(key);
            localStorage.setItem(key, val);
        } catch (e) { return null; }
    }

    /* ---------- Loading screen (first homepage visit per session) ---------- */
    (function () {
        var seen = false;
        try { seen = sessionStorage.getItem('ix-booted') === '1'; } catch (e) {}
        if (REDUCED || seen || !document.getElementById('ix-world')) return;
        try { sessionStorage.setItem('ix-booted', '1'); } catch (e) {}

        var boot = document.createElement('div');
        boot.className = 'ix-boot';
        boot.setAttribute('aria-hidden', 'true');
        boot.innerHTML = '<div class="ix-boot-pct">0%</div><div class="ix-boot-bar"><i></i></div><div>Building your island…</div>';
        document.body.appendChild(boot);

        var pct = boot.querySelector('.ix-boot-pct');
        var bar = boot.querySelector('.ix-boot-bar i');
        var start = null, DURATION = 1200;

        function step(ts) {
            if (!start) start = ts;
            var t = Math.min(1, (ts - start) / DURATION);
            var v = Math.round((1 - Math.pow(1 - t, 3)) * 100);
            pct.textContent = v + '%';
            bar.style.width = v + '%';
            if (t < 1) { requestAnimationFrame(step); return; }
            setTimeout(function () {
                boot.classList.add('done');
                setTimeout(function () { boot.remove(); }, 700);
            }, 150);
        }
        requestAnimationFrame(step);

        // Safety net: never let the loader block the page
        setTimeout(function () {
            boot.classList.add('done');
            setTimeout(function () { boot.remove(); }, 700);
        }, 2600);
    })();

    /* ---------- Idle wallet: coins tick up, click for bonus ---------- */
    (function () {
        var actions = document.querySelector('.navbar .nav-actions');
        if (!actions) return;

        var RATE = 3;
        var coins = parseFloat(store('ix-coins')) || 0;

        var wallet = document.createElement('div');
        wallet.className = 'ix-wallet';
        wallet.innerHTML =
            '<button type="button" class="ix-pill ix-pill-coin" aria-label="Coins — click to collect a bonus">' +
            '<span class="ix-coin-icon" aria-hidden="true"></span><span class="ix-coin-val">0</span><span class="ix-rate">+' + RATE + '/s</span></button>' +
            '<span class="ix-pill ix-pill-gem" aria-label="Gems"><span class="ix-gem-icon" aria-hidden="true"></span><span class="ix-gem-val">0</span></span>';
        actions.parentNode.insertBefore(wallet, actions);

        var coinEl = wallet.querySelector('.ix-coin-val');
        var gemEl = wallet.querySelector('.ix-gem-val');

        function fmt(n) {
            n = Math.floor(n);
            if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
            if (n >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
            return n.toLocaleString();
        }

        function render() {
            coinEl.textContent = fmt(coins);
            gemEl.textContent = Math.floor(coins / 500);
        }

        function floatText(text, x, y) {
            if (REDUCED) return;
            var f = document.createElement('span');
            f.className = 'ix-float';
            f.textContent = text;
            f.style.left = x + 'px';
            f.style.top = y + 'px';
            document.body.appendChild(f);
            setTimeout(function () { f.remove(); }, 900);
        }

        window.ixAddCoins = function (n, x, y) {
            coins += n;
            render();
            store('ix-coins', String(Math.floor(coins)));
            if (x !== undefined) floatText('+' + n, x, y);
        };

        wallet.querySelector('.ix-pill-coin').addEventListener('click', function (e) {
            window.ixAddCoins(10, e.clientX, e.clientY - 10);
        });

        // Coins from the Feel Lab demo also land in the wallet
        document.addEventListener('click', function (e) {
            if (e.target.closest && e.target.closest('.demo-coin')) window.ixAddCoins(5, e.clientX, e.clientY - 20);
        });

        render();
        setInterval(function () {
            coins += RATE;
            render();
            store('ix-coins', String(Math.floor(coins)));
        }, 1000);
    })();

    /* ---------- Terminal typing (engine teaser) ---------- */
    (function () {
        var pre = document.getElementById('ix-term-out');
        if (!pre) return;
        var lines = [
            '<span class="k">$</span> ion init <span class="g">volt-drift</span>',
            '<span class="o">›</span> scaffolding scene graph ......... <span class="g">ok</span>',
            '<span class="o">›</span> compiling shaders (42) .......... <span class="g">ok</span>',
            '<span class="o">›</span> hot-reload bridge ............... <span class="g">live</span>',
            '<span class="k">$</span> ion build --target <span class="g">web,pc,mobile</span>',
            '<span class="o">›</span> bundle 3.8 MB · 60 fps · 0 warnings',
            '<span class="g">✔ ready to ship.</span> <span class="cursor"></span>'
        ];
        if (REDUCED) { pre.innerHTML = lines.join('\n'); return; }
        var started = false;
        var io = new IntersectionObserver(function (en) {
            if (!en[0].isIntersecting || started) return;
            started = true;
            var i = 0;
            (function next() {
                pre.innerHTML = lines.slice(0, i + 1).join('\n');
                i++;
                if (i < lines.length) setTimeout(next, 420);
            })();
        }, { threshold: .4 });
        io.observe(pre);
    })();

    /* ---------- Legal TOC: highlight current section ---------- */
    (function () {
        var links = document.querySelectorAll('.legal-toc a');
        if (!links.length || !('IntersectionObserver' in window)) return;
        var map = {};
        links.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (e) {
                if (!e.isIntersecting) return;
                links.forEach(function (a) { a.classList.remove('active'); });
                var a = map[e.target.id];
                if (a) a.classList.add('active');
            });
        }, { rootMargin: '-20% 0px -70% 0px' });
        Object.keys(map).forEach(function (id) {
            var s = document.getElementById(id);
            if (s) io.observe(s);
        });
    })();

})();
