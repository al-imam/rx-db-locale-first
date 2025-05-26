import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { resolve } from "path";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "~": resolve(__dirname, "./src"),
      process: "process/browser",
    },
  },

  define: { "process.env": {} },
  plugins: [react(), tailwindcss()],
});
