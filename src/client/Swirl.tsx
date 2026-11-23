"use client";
import { useEffect, useRef } from "react";
import { startSwirl } from "./swirl-gl";

// The animated background on every page. It recolors when the theme changes ("alliance-theme" event).
export default function Swirl() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const swirl = startSwirl(ref.current!);
    const recolor = () => swirl.colors();
    window.addEventListener("alliance-theme", recolor);
    return () => {
      window.removeEventListener("alliance-theme", recolor);
      swirl.stop();
    };
  }, []);
  return (
    <>
      <canvas id="bg" ref={ref} aria-hidden="true" />
      <div className="crt" aria-hidden="true" />
    </>
  );
}
