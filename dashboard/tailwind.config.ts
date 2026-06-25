import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#070d08",        // page background (lime-tinted near-black)
        panel: "#0c130d",      // card background
        panel2: "#0f1710",     // nested card
        line: "#19242e",       // borders
        line2: "#22323e",      // brighter borders
        dim: "#5d7282",        // muted text
        fg: "#cdd9e3",         // body text
        cyan: "#aef03a",       // primary accent (lime / chartreuse)
        teal: "#7fb800",       // darker primary shade
        green: "#3fd17e",      // confirmed / landed
        amber: "#f0a73a",      // processing / warning
        red: "#ef5b6b",        // dropped / failed
        violet: "#9a8cff",     // agent / ai
      },
      fontFamily: {
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(174,240,58,0.18), 0 0 22px -8px rgba(174,240,58,0.35)",
      },
    },
  },
  plugins: [],
};

export default config;
