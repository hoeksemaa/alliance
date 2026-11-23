"use client";
import { useEffect, useRef } from "react";
import { COUNTRIES } from "@/lib/countries";
import { mountGame } from "./game-ui";

// The game screen is plain JS (ported from the design draft, with its animations); React only mounts it.
export default function GameClient() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => mountGame(ref.current!, { countries: COUNTRIES }), []);
  return <div ref={ref} style={{ height: "100%" }} />;
}
