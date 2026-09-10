import { MemberAvatar } from './MemberAvatar';
import type { FamilyMember } from '@/types/database';

export function MemberChip({
  member,
  size = 'sm',
}: {
  member: FamilyMember;
  size?: 'sm' | 'md';
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full py-1 pr-3 pl-1 font-medium ${
        size === 'md' ? 'text-base' : 'text-sm'
      }`}
      style={{ backgroundColor: `${member.color}1a`, color: member.color }}
    >
      <MemberAvatar member={member} size="sm" />
      {member.display_name}
    </span>
  );
}
