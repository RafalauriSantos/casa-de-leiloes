import { useParams } from 'react-router-dom';
import { ReceiptLoader } from '@/features/wins';

export function ReceiptPage() {
  const { code = '' } = useParams();
  return <ReceiptLoader code={code} />;
}
