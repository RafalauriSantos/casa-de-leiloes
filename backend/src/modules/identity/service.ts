import type { MeResponse, UserRole } from '@casa/contracts';
import type { Queryable } from '../../shared/db';
import { AppError } from '../../shared/errors';

interface ProfileRow {
  id: string;
  role: UserRole;
  display_name: string;
}

export async function getMe(db: Queryable, userId: string): Promise<MeResponse> {
  const [profile] = await db.query<ProfileRow>('select id, role, display_name from public.profiles where id = $1', [userId]);
  if (!profile) throw new AppError('forbidden', 'Perfil não encontrado para este usuário.');
  return { id: profile.id, role: profile.role, displayName: profile.display_name };
}
