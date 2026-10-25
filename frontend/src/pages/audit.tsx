import { useParams } from 'react-router-dom';
import { AuditLoader } from '@/features/audit';

export function AuditPage() {
  const { id = '' } = useParams();
  return <AuditLoader lotId={id} />;
}
