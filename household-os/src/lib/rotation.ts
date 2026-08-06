/**
 * Fair rotation: cycles a routine's assignee through `rotationMemberIds` in
 * order, one step per completed cycle, so the same person isn't always
 * stuck with the same chore.
 */
export function nextRotationAssignee(
  rotationMemberIds: string[],
  rotationIndex: number
): { memberId: string | null; nextIndex: number } {
  if (rotationMemberIds.length === 0) {
    return { memberId: null, nextIndex: 0 };
  }
  const index = rotationIndex % rotationMemberIds.length;
  const nextIndex = (index + 1) % rotationMemberIds.length;
  return { memberId: rotationMemberIds[index], nextIndex };
}
