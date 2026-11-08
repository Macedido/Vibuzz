/**
 * Web image cropper: drag to place the photo, zoom with the slider or mouse wheel,
 * then "Usar". Plain DOM overlay so it works on top of any screen. Returns a JPEG
 * data URL, or null when cancelled. (Native uses the system cropper instead.)
 */
export function cropImageWeb(src: string, aspect: number | null): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onerror = () => resolve(null);
    img.onload = () => {
      const nw = img.naturalWidth;
      const nh = img.naturalHeight;
      const ratio = aspect ?? nw / nh;
      const maxW = Math.min(window.innerWidth - 32, 420);
      const maxH = Math.min(window.innerHeight - 200, 520);
      let W = maxW;
      let H = W / ratio;
      if (H > maxH) {
        H = maxH;
        W = H * ratio;
      }
      const base = Math.max(W / nw, H / nh);
      let zoom = 1;
      let x = 0;
      let y = 0;
      const size = () => ({ dw: nw * base * zoom, dh: nh * base * zoom });
      const clamp = () => {
        const { dw, dh } = size();
        x = Math.min(0, Math.max(W - dw, x));
        y = Math.min(0, Math.max(H - dh, y));
      };
      {
        const { dw, dh } = size();
        x = (W - dw) / 2;
        y = (H - dh) / 2;
      }

      const root = document.createElement('div');
      root.style.cssText =
        'position:fixed;inset:0;z-index:99999;background:rgba(8,8,14,.88);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;font-family:system-ui,sans-serif;color:#fff;touch-action:none';
      const title = document.createElement('div');
      title.textContent = 'Arraste para posicionar e ajuste o zoom';
      title.style.cssText = 'font-size:15px;opacity:.85';
      const frame = document.createElement('div');
      frame.style.cssText = `position:relative;width:${W}px;height:${H}px;overflow:hidden;border-radius:14px;outline:2px solid rgba(255,255,255,.85);cursor:grab;background:#111`;
      const pic = img.cloneNode() as HTMLImageElement;
      pic.draggable = false;
      pic.style.cssText = 'position:absolute;left:0;top:0;max-width:none;user-select:none;pointer-events:none';
      frame.appendChild(pic);
      const range = document.createElement('input');
      range.type = 'range';
      range.min = '1';
      range.max = '4';
      range.step = '0.01';
      range.value = '1';
      range.style.cssText = `width:${Math.min(W, 320)}px;accent-color:#7c5cff`;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:12px';
      const btn = (label: string, primary: boolean) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.style.cssText = `padding:10px 22px;border-radius:999px;border:${primary ? '0' : '1px solid rgba(255,255,255,.35)'};background:${primary ? '#7c5cff' : 'transparent'};color:#fff;font-size:15px;font-weight:600;cursor:pointer`;
        return b;
      };
      const cancel = btn('Cancelar', false);
      const ok = btn('Usar', true);
      row.append(cancel, ok);
      root.append(title, frame, range, row);
      document.body.appendChild(root);

      const draw = () => {
        const { dw, dh } = size();
        pic.style.width = `${dw}px`;
        pic.style.height = `${dh}px`;
        pic.style.transform = `translate(${x}px, ${y}px)`;
      };
      const setZoom = (z: number) => {
        const before = size();
        const cx = (W / 2 - x) / before.dw;
        const cy = (H / 2 - y) / before.dh;
        zoom = Math.min(4, Math.max(1, z));
        const after = size();
        x = W / 2 - cx * after.dw;
        y = H / 2 - cy * after.dh;
        clamp();
        range.value = String(zoom);
        draw();
      };
      draw();

      let drag: { px: number; py: number; x: number; y: number } | null = null;
      frame.addEventListener('pointerdown', (e) => {
        drag = { px: e.clientX, py: e.clientY, x, y };
        frame.setPointerCapture(e.pointerId);
        frame.style.cursor = 'grabbing';
      });
      frame.addEventListener('pointermove', (e) => {
        if (!drag) return;
        x = drag.x + (e.clientX - drag.px);
        y = drag.y + (e.clientY - drag.py);
        clamp();
        draw();
      });
      const end = () => {
        drag = null;
        frame.style.cursor = 'grab';
      };
      frame.addEventListener('pointerup', end);
      frame.addEventListener('pointercancel', end);
      frame.addEventListener(
        'wheel',
        (e) => {
          e.preventDefault();
          setZoom(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08));
        },
        { passive: false },
      );
      range.addEventListener('input', () => setZoom(Number(range.value)));

      const close = (value: string | null) => {
        root.remove();
        resolve(value);
      };
      cancel.onclick = () => close(null);
      ok.onclick = () => {
        const scale = base * zoom;
        const sw = W / scale;
        const sh = H / scale;
        const outW = Math.round(Math.min(1280, sw));
        const outH = Math.round(outW / ratio);
        const canvas = document.createElement('canvas');
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext('2d');
        if (!ctx) return close(null);
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, outW, outH);
        ctx.drawImage(img, -x / scale, -y / scale, sw, sh, 0, 0, outW, outH);
        close(canvas.toDataURL('image/jpeg', 0.85));
      };
    };
    img.src = src;
  });
}
