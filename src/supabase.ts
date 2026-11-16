import { createClient } from '@supabase/supabase-js';

// Khóa publishable được phép công khai: dữ liệu được bảo vệ bằng RLS trong supabase/schema.sql.
export const supabase = createClient(
  'https://xxekbzkrixiaehqxyjek.supabase.co',
  'sb_publishable_AZaUVmXoX8pGMWepO98L7g_-g4Td9W0',
);

export interface Member { store_id: string; role: 'admin' | 'staff' | 'viewer'; name: string; can_write: boolean; can_delete: boolean; zones?: string[] }
export const canWrite = (m: Member) => m.role === 'admin' || (m.role !== 'viewer' && m.can_write);
export const canDelete = (m: Member) => m.role === 'admin' || (m.role !== 'viewer' && m.can_delete);
