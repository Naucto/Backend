export function friendIdOf(
  friendship: { userAId: string; userBId: string },
  userId: string,
): string {
  return friendship.userAId === userId ? friendship.userBId : friendship.userAId;
}
