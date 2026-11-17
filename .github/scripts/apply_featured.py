#!/usr/bin/env python3
"""Writes the game named in featured.json into the home banner and the Games page poster.

Runs in the Pages deploy (and locally: python3 .github/scripts/apply_featured.py).
Rewrites only the text between <!-- featured:NAME --> ... <!-- /featured:NAME --> markers.
Exits non-zero on an unknown game so a typo fails the deploy instead of breaking the site.
"""
import json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
PLAY = 'https://play.google.com/store/apps/details?id='

GAMES = {
    'idle-bakery-cafe': dict(
        name='Idle Bakery Cafe', play='com.ionixgames.idlebakerycafe', logo=(520, 264),
        crazygames='https://www.crazygames.com/game/idle-bakery-cafe',
        status='Live on Google Play &amp; CrazyGames', tag='Live',
        blurb='Bake, serve, and expand your cozy cafe into the busiest bakery in town. Free to play.',
        hook='Bake, brew &amp; earn — grow a cozy cafe into the busiest bakery in town!',
        alt='Idle Bakery Cafe — a cozy bakery full of fresh pastries and treats'),
    'port-empire-cargo-tycoon': dict(
        name='Port Empire Cargo Tycoon', play='com.ionixgames.portempire&amp;pcampaignid=web_share', logo=(640, 222),
        crazygames=None, status='Live on Google Play', tag='New &amp; Live',
        blurb='Run the docks — load cargo, upgrade ships, and grow a small harbor into a global port empire. Free to play.',
        hook='Run the docks — grow a small harbor into a global port empire!',
        alt='Port Empire Cargo Tycoon — a busy container port with cranes, trains and cargo ships'),
    'juice-king-tycoon': dict(
        name='Juice King Tycoon', play='com.ionixgames.juicekingtycoon', logo=(520, 260),
        crazygames=None, status='Live on Google Play', tag='Live',
        blurb='Build your juice empire — squeeze, sell, upgrade, and grow from a single stand into a juice king. Free to play.',
        hook='Squeeze, sell, upgrade — grow one stand into a juice empire!',
        alt='Juice King Tycoon — a tropical juice farm by the sea'),
}


def blocks(slug, g):
    art, art800 = f'Games/web/{slug}-art.webp', f'Games/web/{slug}-art-800.webp'
    logo = f'Games/web/{slug}-logo.webp'
    srcset = f'{art800} 800w, {art} 1100w'
    sizes = '(max-width: 760px) 100vw, 1200px'
    lw, lh = g['logo']
    second = (f'<a href="{g["crazygames"]}" class="btn btn-outline" target="_blank" rel="noopener">Play In Browser</a>'
              if g['crazygames'] else '<a href="games.html" class="btn btn-outline">All Games</a>')
    return {
        'home': f'''
                <article class="ix-feature" style="background-image:url('{art}')">
                    <div class="ix-feature-body">
                        <img src="{logo}" alt="{g["name"]}" width="{lw}" height="{lh}" loading="lazy">
                        <span class="ix-status"><img class="ui-ico" src="UIAtlas/web/google-play.webp" alt="" width="20" height="20">{g["status"]}</span>
                        <p>{g["blurb"]}</p>
                        <div class="hero-actions">
                            <a href="{PLAY}{g["play"]}" class="btn btn-green" target="_blank" rel="noopener">Play Free <span class="arrow">→</span></a>
                            {second}
                        </div>
                    </div>
                </article>
                ''',
        'preload': f'''
    <link rel="preload" as="image" href="{art}" imagesrcset="{srcset}" imagesizes="{sizes}" fetchpriority="high">
    ''',
        'poster': f'''
                <a href="{PLAY}{g["play"]}" class="ix-poster" data-game="{g["name"]}" target="_blank" rel="noopener" aria-label="Play {g["name"]} free on Google Play">
                    <img src="{art}" srcset="{srcset}" sizes="{sizes}" alt="{g["alt"]}" width="1100" height="619" fetchpriority="high" decoding="async">
                    <img class="ix-poster-logo" src="{logo}" alt="" width="{lw}" height="{lh}" decoding="async">
                    <span class="ix-poster-info">
                        <span class="ix-poster-hook"><span class="ix-poster-tag"><img class="ui-ico" src="UIAtlas/web/live.webp" alt="" width="20" height="20">{g["tag"]}</span>{g["hook"]}</span>
                        <span class="btn btn-green ix-poster-cta"><img class="ui-ico" src="UIAtlas/web/google-play.webp" alt="" width="20" height="20">Play Now <span class="arrow">→</span></span>
                    </span>
                </a>
                ''',
    }


def main():
    slug = json.loads((ROOT / 'featured.json').read_text()).get('featured', '').strip()
    if slug not in GAMES:
        sys.exit(f'featured.json: unknown game "{slug}". Use one of: {", ".join(GAMES)}')
    for f in ['Games/web/' + slug + s for s in ('-art.webp', '-art-800.webp', '-logo.webp')]:
        if not (ROOT / f).exists():
            sys.exit(f'featured.json: missing art file {f}')
    b = blocks(slug, GAMES[slug])
    for page, names in {'index.html': ['home'], 'games.html': ['preload', 'poster']}.items():
        path = ROOT / page
        html = path.read_text()
        for n in names:
            html, count = re.subn(rf'(<!-- featured:{n} -->).*?(\s*<!-- /featured:{n} -->)',
                                  lambda m: m.group(1) + b[n].rstrip() + m.group(2), html, flags=re.S)
            if count != 1:
                sys.exit(f'{page}: expected one featured:{n} marker pair, found {count}')
        path.write_text(html)
    print(f'featured game: {GAMES[slug]["name"]}')


if __name__ == '__main__':
    main()
