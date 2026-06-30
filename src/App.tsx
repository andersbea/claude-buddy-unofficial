import { useBuddy } from './hooks/useBuddy';
import { Device } from './components/Device';

export default function App() {
  const view = useBuddy();
  return <Device view={view} />;
}
