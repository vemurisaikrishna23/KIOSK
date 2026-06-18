import { useState } from "react";
import "./KioskRightPanel.css";

/**
 * Right-side hero panel for the auth pages — shows the rendered smart-kiosk
 * dashboard artwork on the warm cream backdrop, with a soft glow + drop
 * shadow and a gentle float for depth ("enhancement"). Drop the artwork at
 * frontend/public/kiosk-hero.png. If the file is missing the image hides
 * itself so the panel stays a clean gradient instead of a broken icon.
 */
export default function KioskRightPanel() {
  const [ok, setOk] = useState(true);

  return (
    <section className="kiosk-right-panel">
      {ok && (
        <img
          className="kiosk-hero-img"
          src="/kiosk-hero.png"
          alt="Smart kiosk dashboard — live telemetry, camera feeds, device status and controls"
          loading="eager"
          draggable="false"
          onError={() => setOk(false)}
        />
      )}
    </section>
  );
}
