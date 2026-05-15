import { useEffect } from 'react';

export function useScrollytelling() {
  useEffect(() => {
    const scenes = Array.from(document.querySelectorAll<HTMLElement>('.scene'));
    const progress = document.querySelector<HTMLElement>('.progress');
    const piprail = document.querySelector<HTMLElement>('.piprail');

    if (piprail) {
      piprail.innerHTML = '';
      scenes.forEach((s, i) => {
        const pip = document.createElement('div');
        pip.className = 'pip';
        pip.title = s.dataset.title || `Chapter ${i + 1}`;
        pip.addEventListener('click', () => {
          s.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        piprail.appendChild(pip);
      });
    }

    document.querySelectorAll<HTMLElement>('.reveal-words').forEach((el) => {
      if (el.dataset.split) return;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      while (walker.nextNode()) nodes.push(walker.currentNode as Text);
      nodes.forEach((node) => {
        const parts = node.nodeValue!.split(/(\s+)/);
        const frag = document.createDocumentFragment();
        parts.forEach((p) => {
          if (/^\s+$/.test(p)) {
            frag.appendChild(document.createTextNode(p));
          } else if (p.length) {
            const span = document.createElement('span');
            span.className = 'word';
            span.textContent = p;
            frag.appendChild(span);
          }
        });
        node.parentNode!.replaceChild(frag, node);
      });
      el.querySelectorAll<HTMLElement>('.word').forEach((w, i) => {
        w.style.transitionDelay = i * 60 + 'ms';
      });
      el.dataset.split = '1';
    });

    function runTickers(scope: Element) {
      scope.querySelectorAll<HTMLElement>('.tick[data-target]').forEach((el) => {
        if (el.dataset.ticked) return;
        el.dataset.ticked = '1';
        const target = parseFloat(el.dataset.target || '0');
        const decimals = +(el.dataset.decimals || 0);
        const prefix = el.dataset.prefix || '';
        const suffix = el.dataset.suffix || '';
        const dur = +(el.dataset.dur || 1600);
        const t0 = performance.now();
        const fmt = (v: number) =>
          prefix +
          v.toLocaleString('en-US', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
          }) +
          suffix;
        const tick = (now: number) => {
          const t = Math.min(1, (now - t0) / dur);
          const k = 1 - Math.pow(1 - t, 3);
          el.textContent = fmt(target * k);
          if (t < 1) requestAnimationFrame(tick);
          else el.textContent = fmt(target);
        };
        requestAnimationFrame(tick);
      });
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            runTickers(e.target);
          }
        });
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0 },
    );
    scenes.forEach((s) => io.observe(s));

    function revealVisible() {
      scenes.forEach((s) => {
        const r = s.getBoundingClientRect();
        if (r.top < window.innerHeight * 0.9 && r.bottom > window.innerHeight * 0.1) {
          s.classList.add('in');
          runTickers(s);
        }
      });
    }
    if (scenes[0]) {
      scenes[0].classList.add('in');
      runTickers(scenes[0]);
    }
    const t1 = setTimeout(revealVisible, 100);
    const t2 = setTimeout(revealVisible, 600);
    window.addEventListener('load', revealVisible);

    let revealRaf = 0;
    const onScrollReveal = () => {
      if (revealRaf) return;
      revealRaf = requestAnimationFrame(() => {
        revealRaf = 0;
        revealVisible();
      });
    };
    window.addEventListener('scroll', onScrollReveal, { passive: true });

    const activeIO = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && e.intersectionRatio >= 0.5) {
            const idx = scenes.indexOf(e.target as HTMLElement);
            if (idx < 0) return;
            if (!piprail) return;
            Array.from(piprail.children).forEach((p, i) => {
              p.classList.toggle('active', i === idx);
              const target = e.target as HTMLElement;
              const dark =
                target.classList.contains('bg-ink') ||
                target.classList.contains('bg-accent') ||
                target.classList.contains('bg-gold') ||
                target.classList.contains('bg-slate') ||
                target.dataset.darkRail === '1';
              p.classList.toggle('dark', dark);
            });
          }
        });
      },
      { threshold: [0.5] },
    );
    scenes.forEach((s) => activeIO.observe(s));

    let raf = 0;
    function updateProgress() {
      raf = 0;
      const total = document.documentElement.scrollHeight - window.innerHeight;
      const p = total > 0 ? Math.min(1, Math.max(0, window.scrollY / total)) : 0;
      if (progress) progress.style.width = p * 100 + '%';
    }
    const onScrollProgress = () => {
      if (!raf) raf = requestAnimationFrame(updateProgress);
    };
    document.addEventListener('scroll', onScrollProgress, { passive: true });
    updateProgress();

    function onKey(e: KeyboardEvent) {
      const cur = scenes.findIndex((s) => {
        const r = s.getBoundingClientRect();
        return r.top <= window.innerHeight * 0.5 && r.bottom > window.innerHeight * 0.5;
      });
      if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault();
        const next = scenes[Math.min(scenes.length - 1, cur + 1)];
        if (next) next.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        const prev = scenes[Math.max(0, cur - 1)];
        if (prev) prev.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
    document.addEventListener('keydown', onKey);

    return () => {
      io.disconnect();
      activeIO.disconnect();
      window.removeEventListener('load', revealVisible);
      window.removeEventListener('scroll', onScrollReveal);
      document.removeEventListener('scroll', onScrollProgress);
      document.removeEventListener('keydown', onKey);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);
}
