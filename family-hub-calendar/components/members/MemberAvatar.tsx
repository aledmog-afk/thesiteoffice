import type { FamilyMember } from '@/types/database';

const SIZES = {
  sm: 'h-8 w-8 text-sm',
  md: 'h-11 w-11 text-base', // 44px — the minimum tap target from §2.1
  lg: 'h-16 w-16 text-2xl',
  xl: 'h-24 w-24 text-4xl',
} as const;

export function MemberAvatar({
  member,
  size = 'md',
  ring = false,
}: {
  member: FamilyMember;
  size?: keyof typeof SIZES;
  ring?: boolean;
}) {
  const initial = member.display_name.trim().charAt(0).toUpperCase();

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white select-none ${SIZES[size]} ${
        ring ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-100' : ''
      }`}
      style={{ backgroundColor: member.color }}
      aria-hidden
    >
      {member.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element -- Storage-signed
        // URLs rotate, so next/image's optimiser cache works against us here.
        <img src={member.avatar_url} alt="" className="h-full w-full object-cover" />
      ) : (
        member.avatar_emoji || initial
      )}
    </span>
  );
}
