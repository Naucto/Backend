export function friendIdOf(
  friendship: { userAId: number; userBId: number },
  userId: number,
): number {
  return friendship.userAId === userId ? friendship.userBId : friendship.userAId;
}
