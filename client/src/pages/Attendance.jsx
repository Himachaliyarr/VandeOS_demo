import { CalendarDays, Clock3, Crosshair, MapPin, Navigation, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { api, formatDate, formatTime, titleCase } from '../lib/api.js';
import { Badge, EmptyState, ErrorBanner, Loading, Metric, PageHeader, Panel, StatusBadge, TableWrap } from '../components/Primitives.jsx';

const currentMonth = () => new Date().toISOString().slice(0, 7);
const locationError = error => ({ 1: 'Location permission was denied. Enable it in your browser settings or use approved remote attendance.', 2: 'Your device could not determine your location. Move near a window or try again.', 3: 'Location request timed out. Please try again.' })[error.code] || 'Unable to read your location.';

export default function Attendance() {
  const { user } = useAuth();
  const [records, setRecords] = useState([]);
  const [today, setToday] = useState(null);
  const [office, setOffice] = useState(null);
  const [report, setReport] = useState([]);
  const [month, setMonth] = useState(currentMonth());
  const [busy, setBusy] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const isStaff = ['SUPER_ADMIN', 'HR'].includes(user.role);

  const load = async () => {
    setBusy(true); setError('');
    try {
      const [mine, org] = await Promise.all([api(`/attendance/me?month=${month}`), api('/organization')]);
      setRecords(mine.data.records); setToday(mine.data.records.find(row => row.workDate === mine.data.workDate) || null); setOffice(org.data.organization);
      if (isStaff) { const all = await api(`/attendance?month=${month}&limit=100`); setReport(all.data.records); }
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  useEffect(() => { load(); }, [month]);

  const recordCheckIn = async body => {
    setActionBusy(true); setError(''); setMessage('');
    try { const result = await api('/attendance/check-in', { method: 'POST', body }); setMessage(result.message); await load(); }
    catch (err) { setError(err.message); } finally { setActionBusy(false); }
  };
  const officeCheckIn = () => {
    if (!navigator.geolocation) { setError('This browser does not support GPS.'); return; }
    setActionBusy(true); setError(''); setMessage('');
    navigator.geolocation.getCurrentPosition(async position => {
      try {
        const result = await api('/attendance/check-in', { method: 'POST', body: { method: 'OFFICE_GPS', latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy } });
        setMessage(result.message); await load();
      } catch (err) { setError(err.message); } finally { setActionBusy(false); }
    }, err => { setError(locationError(err)); setActionBusy(false); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  };
  const checkOut = async () => {
    setActionBusy(true); setError(''); setMessage('');
    try { const result = await api('/attendance/check-out', { method: 'POST', body: {} }); setMessage(result.message); await load(); }
    catch (err) { setError(err.message); } finally { setActionBusy(false); }
  };

  const hours = records.reduce((total, row) => total + row.totalMinutes, 0);
  const gpsReady = office?.settings?.officeLatitude !== null && office?.settings?.officeLatitude !== undefined;
  if (busy && !office) return <Loading />;
  return <>
    <PageHeader eyebrow="SHOW UP, YOUR WAY" title="Attendance" description="A clear record of your time, whether you’re at the office or approved to work remotely." action={<label className="month-picker"><CalendarDays size={16} /><input type="month" value={month} onChange={e => setMonth(e.target.value)} /></label>} />
    <ErrorBanner>{error}</ErrorBanner>{message && <div className="success-banner">{message}</div>}
    <div className="attendance-hero"><div className="attendance-hero-copy"><p className="eyebrow">TODAY · {new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()).toUpperCase()}</p><h2>{today?.checkOut ? 'You’re all wrapped up.' : today ? 'You’re on the clock.' : 'Ready when you are.'}</h2><p>{today?.checkOut ? 'Your workday is complete. Nice work today.' : today ? 'Your attendance is running. Remember to check out when you finish.' : 'Record your attendance to get your day started.'}</p><div className="attendance-actions">{!today ? <><button className="button button-primary" onClick={officeCheckIn} disabled={actionBusy || !gpsReady}><MapPin size={16} />{actionBusy ? 'Getting location…' : 'Check in at office'}</button>{user.remoteApproved && <button className="button button-secondary button-remote" onClick={() => recordCheckIn({ method: 'REMOTE_WEB' })} disabled={actionBusy}><Navigation size={16} /> Check in remotely</button>}</> : !today.checkOut ? <button className="button button-primary" onClick={checkOut} disabled={actionBusy}><Clock3 size={16} />{actionBusy ? 'Saving…' : 'Check out'}</button> : <Badge tone="green">Day complete</Badge>}</div></div><div className="attendance-clock"><div className="clock-face"><div className="clock-center" /><div className="clock-hand clock-hour" /><div className="clock-hand clock-minute" /><span className="clock-tick tick-12" /><span className="clock-tick tick-3" /><span className="clock-tick tick-6" /><span className="clock-tick tick-9" /></div><div className="clock-live"><span />LIVE LOCAL TIME</div><strong>{new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit' }).format(new Date())}</strong><small>{office?.timezone || 'Asia/Kolkata'}</small></div><div className="hero-decoration"><span /><span /><span /></div></div>
    {!gpsReady && <div className="setup-notice"><span className="notice-icon"><MapPin size={17} /></span><div><strong>Office GPS isn’t configured yet</strong><p>The Owner must add verified office coordinates in Workspace Settings before office check-in can work.</p></div>{isStaff && <a href="/settings" className="text-link">Set up office →</a>}</div>}
    <div className="metrics-grid attendance-metrics"><Metric label="Days recorded" value={records.length} trend={`In ${new Date(`${month}-02`).toLocaleDateString('en', { month: 'long' })}`} icon={<CalendarDays size={18} />} accent="mint" /><Metric label="Hours worked" value={`${Math.floor(hours / 60)}h ${hours % 60}m`} trend="Completed attendance records" icon={<Clock3 size={18} />} accent="blue" /><Metric label="Current shift" value={user.shift?.name || 'Flexible'} trend={user.shift ? `${user.shift.startTime} – ${user.shift.endTime}` : 'No shift assigned'} icon={<Crosshair size={18} />} accent="purple" /><Metric label="Attendance method" value={user.remoteApproved ? 'Office or remote' : 'Office GPS'} trend={user.remoteApproved ? 'Remote work approved' : 'Location required at office'} icon={<ShieldCheck size={18} />} accent="amber" /></div>
    <div className={isStaff ? 'attendance-two-col' : ''}><Panel title={isStaff ? 'Your attendance' : 'Your attendance history'} subtitle="Attendance is recorded using the server’s local time." action={<div className="location-note"><MapPin size={14} /> Location is used for check-in only</div>}>{busy ? <Loading /> : records.length ? <TableWrap><thead><tr><th>Work day</th><th>Check in</th><th>Check out</th><th>Method</th><th>Hours</th><th>Status</th></tr></thead><tbody>{records.map(row => <tr key={row._id}><td className="cell-strong">{formatDate(`${row.workDate}T12:00:00`)}</td><td>{formatTime(row.checkIn.at)}</td><td>{formatTime(row.checkOut?.at)}</td><td><Badge tone={row.checkIn.method === 'OFFICE_GPS' ? 'blue' : 'purple'}>{row.checkIn.method === 'OFFICE_GPS' ? 'Office GPS' : 'Remote web'}</Badge></td><td>{row.totalMinutes ? `${Math.floor(row.totalMinutes / 60)}h ${row.totalMinutes % 60}m` : '—'}</td><td><StatusBadge status={row.status} /></td></tr>)}</tbody></TableWrap> : <EmptyState title="No attendance for this month" text="Your check-ins will appear here." />}</Panel>
    {isStaff && <Panel title="Team report" subtitle={`Attendance for ${month}`}><TableWrap><thead><tr><th>Team member</th><th>Department</th><th>Work date</th><th>Check in</th><th>Method</th><th>Status</th></tr></thead><tbody>{report.map(row => <tr key={row._id}><td className="cell-strong">{row.user?.name}</td><td>{row.user?.department?.name || '—'}</td><td>{row.workDate}</td><td>{formatTime(row.checkIn.at)}</td><td>{row.checkIn.method === 'OFFICE_GPS' ? 'Office GPS' : 'Remote web'}</td><td><StatusBadge status={row.status} /></td></tr>)}</tbody></TableWrap>{report.length === 0 && <EmptyState title="No team records for this month" text="Team check-ins will be listed here." />}</Panel>}</div>
    <div className="privacy-footnote"><ShieldCheck size={16} /><span>GPS coordinates are captured only for office check-in and saved with the attendance record. Remote web attendance is available only to employees approved by HR or the Owner.</span></div>
  </>;
}
