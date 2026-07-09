import { useEffect, useRef } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "@/components/app-shell";
import ChatPage from "@/pages/Chat";
import DownloadsPage from "@/pages/Downloads";
import PlaylistPage from "@/pages/Playlist";
import SettingsPage from "@/pages/Settings";
import { useAppStore } from "@/stores/app-store";

export default function App() {
  const bootstrap = useAppStore((state) => state.bootstrap);
  const bootstrapped = useAppStore((state) => state.bootstrapped);
  const hasStartedBootstrap = useRef(false);

  useEffect(() => {
    if (!bootstrapped && !hasStartedBootstrap.current) {
      hasStartedBootstrap.current = true;
      void bootstrap();
    }
  }, [bootstrap, bootstrapped]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/app/chat" replace />} />
        <Route path="/app" element={<AppShell />}>
          <Route path="chat" element={<ChatPage />} />
          <Route path="downloads" element={<DownloadsPage />} />
          <Route path="playlist" element={<PlaylistPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
