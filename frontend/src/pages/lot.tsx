import { useParams } from 'react-router-dom';
import { LotDetail } from '@/features/lots';

export function LotPage() {
  const { id = '' } = useParams();
  return <LotDetail id={id} />;
}
