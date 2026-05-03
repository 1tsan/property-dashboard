// ─── ChainReady / Fasanya shared navigation ───────────────────────────────────
// Update this one file and all pages reflect the change instantly.
(function () {
  const MARKET_RATE = 4.35; // Best 5yr fixed May 2026 (HomeOwners Alliance / L&C)
  if (typeof window !== 'undefined') window.MARKET_RATE = MARKET_RATE;

  const pages = [
    { label: 'Home',       href: '/' },
    { label: 'ChainReady', href: '/ChainReady' },
    { label: 'Resources',  href: '/resources' },
  ];

  const current = window.location.pathname.replace(/\/$/, '') || '/';

  const css = `
    #fn-nav-overlay{position:fixed;inset:0;background:rgba(8,7,15,0.7);z-index:998;opacity:0;pointer-events:none;transition:opacity 0.3s;backdrop-filter:blur(4px);}
    #fn-nav-overlay.open{opacity:1;pointer-events:all;}
    #fn-nav-drawer{position:fixed;top:0;left:0;bottom:0;width:260px;background:#111019;z-index:999;transform:translateX(-100%);transition:transform 0.32s cubic-bezier(0.22,1,0.36,1);border-right:1px solid rgba(255,255,255,0.06);display:flex;flex-direction:column;visibility:hidden;}
    #fn-nav-drawer.open{transform:translateX(0);}
    #fn-nav-header{padding:18px 20px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;justify-content:space-between;}
    #fn-nav-logo{font-family:'Georgia',serif;font-size:16px;letter-spacing:5px;text-transform:uppercase;color:#f0ede8;text-decoration:none;}
    #fn-nav-close{width:28px;height:28px;background:rgba(255,255,255,0.06);border:none;border-radius:50%;color:#f0ede8;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;line-height:1;}
    #fn-nav-links{padding:24px 0;flex:1;}
    .fn-nav-link{display:block;padding:11px 24px;font-family:'Outfit',sans-serif;font-size:14px;font-weight:400;color:rgba(240,237,232,0.65);text-decoration:none;letter-spacing:0.2px;transition:color 0.18s,background 0.18s;border-left:2px solid transparent;}
    .fn-nav-link:hover{color:#f0ede8;background:rgba(255,255,255,0.04);}
    .fn-nav-link.active{color:#c9a96e;border-left-color:#c9a96e;background:rgba(201,169,110,0.05);}
    #fn-nav-footer{padding:18px 24px;border-top:1px solid rgba(255,255,255,0.06);font-size:11px;color:rgba(240,237,232,0.3);font-family:'Outfit',sans-serif;}
    #fn-burger{position:fixed;top:14px;left:16px;z-index:997;width:36px;height:36px;background:rgba(8,7,15,0.75);border:1px solid rgba(255,255,255,0.1);border-radius:8px;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;backdrop-filter:blur(10px);transition:background 0.2s;}
    #fn-burger:hover{background:rgba(201,169,110,0.15);border-color:rgba(201,169,110,0.3);}
    #fn-burger span{display:block;width:16px;height:1.5px;background:#c9a96e;border-radius:1px;transition:all 0.25s;}
    #fn-burger.open span:nth-child(1){transform:translateY(5.5px) rotate(45deg);}
    #fn-burger.open span:nth-child(2){opacity:0;}
    #fn-burger.open span:nth-child(3){transform:translateY(-5.5px) rotate(-45deg);}
  `;

  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const overlay = document.createElement('div');
  overlay.id = 'fn-nav-overlay';

  const drawer = document.createElement('div');
  drawer.id = 'fn-nav-drawer';
  drawer.innerHTML = `
    <div id="fn-nav-header">
      <a href="/" id="fn-nav-logo">Fasanya</a>
      <button id="fn-nav-close" aria-label="Close menu">✕</button>
    </div>
    <nav id="fn-nav-links">
      ${pages.map(p => {
        const isActive = p.href === '/' ? current === '' || current === '/' : current.toLowerCase().startsWith(p.href.toLowerCase());
        return `<a href="${p.href}" class="fn-nav-link${isActive ? ' active' : ''}">${p.label}</a>`;
      }).join('')}
    </nav>
    <div id="fn-nav-footer">© 2026 Fasanya · All rights reserved</div>
  `;

  const burger = document.createElement('button');
  burger.id = 'fn-burger';
  burger.setAttribute('aria-label', 'Open menu');
  burger.innerHTML = '<span></span><span></span><span></span>';

  function open() {
    drawer.style.visibility = 'visible';
    overlay.classList.add('open');
    drawer.classList.add('open');
    burger.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function close() {
    overlay.classList.remove('open');
    drawer.classList.remove('open');
    burger.classList.remove('open');
    document.body.style.overflow = '';
    setTimeout(() => { if (!drawer.classList.contains('open')) drawer.style.visibility = 'hidden'; }, 320);
  }

  burger.addEventListener('click', () => drawer.classList.contains('open') ? close() : open());
  overlay.addEventListener('click', close);
  drawer.querySelector('#fn-nav-close').addEventListener('click', close);
  drawer.querySelectorAll('.fn-nav-link').forEach(l => l.addEventListener('click', close));

  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  document.body.appendChild(overlay);
  document.body.appendChild(drawer);
  document.body.appendChild(burger);
})();
