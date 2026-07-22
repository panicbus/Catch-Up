import { HashRouter, Routes, Route } from 'react-router-dom';
import { AppShell } from './components/Layout/AppShell';
import { HomePage } from './components/Home/HomePage';
import { ChannelPage } from './components/Channel/ChannelPage';
import { PoolPage } from './components/Pool/PoolPage';
import { BookmarksPage } from './components/Bookmarks/BookmarksPage';
import { SettingsPage } from './components/Settings/SettingsPage';

export default function App() {
  return (
    <div className="app-root">
      <HashRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/pool" element={<PoolPage />} />
            <Route path="/channel/:channelId" element={<ChannelPage />} />
            <Route path="/bookmarks" element={<BookmarksPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </HashRouter>
    </div>
  );
}
