import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from './lib/store.tsx';
import { Logo } from './components/Logo.tsx';
import { Avatar } from './components/Avatar.tsx';
import { DemoBadge, ErrorBox, Loading } from './components/ui.tsx';
import { getSocket } from './lib/socket.ts';
import { NameGate } from './components/NamePicker.tsx';
import { modeName } from './lib/format.ts';

const Home = lazy(() => import('./pages/Home.tsx'));
const Modes = lazy(() => import('./pages/Modes.tsx'));
const Play = lazy(() => import('./pages/Play.tsx'));
const Maps = lazy(() => import('./pages/Maps.tsx'));
const MapDetail = lazy(() => import('./pages/MapDetail.tsx'));
const Editor = lazy(() => import('./pages/Editor.tsx'));
const Daily = lazy(() => import('./pages/Daily.tsx'));
const Explorer = lazy(() => import('./pages/Explorer.tsx'));
const Challenge = lazy(() => import('./pages/Challenge.tsx'));
const Rooms = lazy(() => import('./pages/Rooms.tsx'));
const Room = lazy(() => import('./pages/Room.tsx'));
const Profile = lazy(() => import('./pages/Profile.tsx'));
const Leaderboards = lazy(() => import('./pages/Leaderboards.tsx'));
const Friends = lazy(() => import('./pages/Friends.tsx'));
const Settings = lazy(() => import('./pages/Settings.tsx'));
const About = lazy(() => import('./pages/About.tsx'));
const NotFound = lazy(() => import('./pages/NotFound.tsx'));

/** Full-screen routes hide the site chrome. */
const isFullscreen = (path: string) => /^\/play\/[^/]+$/.test(path) || /^\/r\/[^/]+$/.test(path);

export default function App() {
  const { user, ready, bootError, toast } = useApp();
  const loc = useLocation();
  const nav = useNavigate();
  const [menu, setMenu] = useState(false);
  const full = isFullscreen(loc.pathname);
  useEffect(() => setMenu(false), [loc.pathname]);

  // Friend invitations arrive over the socket wherever you are in the app.
  useEffect(() => {
    if (!ready || user?.guest) return;
    const s = getSocket();
    const onInvite = (i: { code: string; from: string; format: string }) =>
      toast(`${i.from} invited you to a ${modeName(i.format)} room`, 'info', { label: 'Join', onClick: () => nav(`/r/${i.code}`) });
    s.on('invite', onInvite);
    return () => { s.off('invite', onInvite); };
  }, [ready, user?.guest, toast, nav]);

  if (bootError) return <div className="main"><ErrorBox message={`Could not start Nearabouts: ${bootError}`} onRetry={() => location.reload()} /></div>;
  if (!ready) return <div className="main"><Loading label="Starting Nearabouts…" /></div>;

  return (
    <div className="app">
      {!full && (
        <header className="topbar">
          <Link to="/" className="brand" aria-label="Nearabouts home"><Logo /> Nearabouts</Link>
          <nav className={`nav ${menu ? 'open' : ''}`} aria-label="Main">
            <NavLink to="/play">Play</NavLink>
            <NavLink to="/daily">Daily</NavLink>
            <NavLink to="/rooms">With friends</NavLink>
            <NavLink to="/maps">Maps</NavLink>
            <NavLink to="/leaderboards">Leaderboards</NavLink>
            <NavLink to="/friends">Friends</NavLink>
          </nav>
          <div className="spacer" />
          <span className="hide-sm"><DemoBadge /></span>
          <Link to={`/u/${user!.username}`} className="row tight" style={{ color: 'var(--text)' }} title="Your profile">
            <Avatar avatar={user!.avatar} size={30} />
            <span className="small hide-sm" style={{ fontWeight: 700 }}>{user!.username}</span>
            <span className="chip hide-sm">Lv {user!.level.level}</span>
          </Link>
          <Link to="/settings" className="btn ghost icon sm" aria-label="Settings" title="Settings">⚙</Link>
          <button className="btn ghost icon sm menu-btn" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>☰</button>
        </header>
      )}
      {user!.guest ? <NameGate /> : (
      <Suspense fallback={<div className="main"><Loading /></div>}>
        <Routes>
          <Route path="/" element={<Page><Home /></Page>} />
          <Route path="/play" element={<Page><Modes /></Page>} />
          <Route path="/play/:id" element={<Play />} />
          <Route path="/maps" element={<Page><Maps /></Page>} />
          <Route path="/maps/:slug" element={<Page><MapDetail /></Page>} />
          <Route path="/maps/:slug/edit" element={<Page wide><Editor /></Page>} />
          <Route path="/daily" element={<Page><Daily /></Page>} />
          <Route path="/explorer" element={<Page><Explorer /></Page>} />
          <Route path="/c/:code" element={<Page><Challenge /></Page>} />
          <Route path="/rooms" element={<Page><Rooms /></Page>} />
          <Route path="/r/:code" element={<Room />} />
          <Route path="/u/:username" element={<Page><Profile /></Page>} />
          <Route path="/leaderboards" element={<Page><Leaderboards /></Page>} />
          <Route path="/friends" element={<Page><Friends /></Page>} />
          <Route path="/settings" element={<Page><Settings /></Page>} />
          <Route path="/about" element={<Page><About /></Page>} />
          <Route path="*" element={<Page><NotFound /></Page>} />
        </Routes>
      </Suspense>
      )}
      {!full && (
        <footer className="footer">
          <Link to="/about">How to play &amp; scoring</Link>
          <Link to="/about#credits">Credits &amp; data</Link>
          <Link to="/about#privacy">Privacy</Link>
        </footer>
      )}
    </div>
  );
}

function Page({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return <main className={`main ${wide ? 'wide' : ''} fade-in`} id="main">{children}</main>;
}
