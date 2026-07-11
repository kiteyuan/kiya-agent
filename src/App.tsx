import { useEffect, useRef } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "@/components/app-shell";
import ChatPage from "@/pages/Chat.tsx";
import DiagnosticsPage from "@/pages/Diagnostics.tsx";
import DownloadsPage from "@/pages/Downloads";
import PlaylistPage from "@/pages/Playlist";
import SettingsPage from "@/pages/Settings";
import { useAppStore } from "@/stores/app-store";
import { useChatStore } from "@/stores/chat-store";
import { useDownloadStore } from "@/stores/download-store";
import { usePlaylistStore } from "@/stores/playlist-store";

export default function App() {
  const bootstrap = useAppStore((state) => state.bootstrap);
  const bootstrapped = useAppStore((state) => state.bootstrapped);
  const hydrateChat = useChatStore((state) => state.hydrate);
  const hydrateDownloads = useDownloadStore((state) => state.hydrate);
  const hydratePlaylist = usePlaylistStore((state) => state.hydrate);
  const hasStartedBootstrap = useRef(false);
  const hasHydratedChat = useRef(false);
  const hasHydratedDownloads = useRef(false);
  const hasHydratedPlaylist = useRef(false);

  useEffect(() => {
    if (!bootstrapped && !hasStartedBootstrap.current) {
      hasStartedBootstrap.current = true;
      void bootstrap();
    }
  }, [bootstrap, bootstrapped]);

  useEffect(() => {
    if (!hasHydratedChat.current) {
      hasHydratedChat.current = true;
      void hydrateChat();
    }
  }, [hydrateChat]);

  useEffect(() => {
    if (!hasHydratedDownloads.current) {
      hasHydratedDownloads.current = true;
      void hydrateDownloads();
    }
  }, [hydrateDownloads]);

  useEffect(() => {
    if (!hasHydratedPlaylist.current) {
      hasHydratedPlaylist.current = true;
      void hydratePlaylist();
    }
  }, [hydratePlaylist]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/app/chat" replace />} />
        <Route path="/app" element={<AppShell />}>
          <Route path="chat" element={<ChatPage />} />
          <Route path="downloads" element={<DownloadsPage />} />
          <Route path="playlist" element={<PlaylistPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="diagnostics" element={<DiagnosticsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
