import type { Role, UserDto } from '@ims/shared';
import type { Types } from 'mongoose';

interface UserLike {
  _id: Types.ObjectId;
  name: string;
  email: string;
  role: Role;
  isActive?: boolean | null;
  lastLoginAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** The only shape in which a user leaves the API. Never includes the password hash. */
export function toUserDto(user: UserLike): UserDto {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive ?? true,
    ...(user.lastLoginAt && { lastLoginAt: user.lastLoginAt.toISOString() }),
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
