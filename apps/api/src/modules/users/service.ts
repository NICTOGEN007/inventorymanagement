import type { CreateUserInput, Role, UpdateUserInput, UserDto } from '@ims/shared';
import type mongoose from 'mongoose';
import { isValidObjectId } from 'mongoose';
import { UserModel } from '../../models/index.js';
import { AppError } from '../../utils/app-error.js';
import { hashPassword } from '../../utils/password.js';
import { containsPattern } from '../../utils/query.js';
import { revokeUserSessions } from '../auth/service.js';
import { toUserDto } from './dto.js';

export interface ListUsersQuery {
  search?: string;
  role?: Role;
  status?: 'active' | 'inactive';
}

export async function listUsers({ search, role, status }: ListUsersQuery): Promise<UserDto[]> {
  const filter: mongoose.QueryFilter<Record<string, unknown>> = {};
  if (role) filter.role = role;
  if (status) filter.isActive = status === 'active';
  if (search) {
    const pattern = containsPattern(search);
    filter.$or = [{ name: pattern }, { email: pattern }];
  }
  const users = await UserModel.find(filter).sort({ isActive: -1, name: 1 }).limit(500).lean();
  return users.map(toUserDto);
}

async function findUserOr404(id: string) {
  const user = isValidObjectId(id) ? await UserModel.findById(id) : null;
  if (!user) throw AppError.notFound('User not found');
  return user;
}

export async function getUser(id: string): Promise<UserDto> {
  return toUserDto(await findUserOr404(id));
}

export async function createUser(input: CreateUserInput): Promise<UserDto> {
  if (await UserModel.exists({ email: input.email })) {
    throw AppError.conflict('A user with this email already exists');
  }
  try {
    const user = await UserModel.create({
      name: input.name,
      email: input.email,
      role: input.role,
      passwordHash: await hashPassword(input.password),
    });
    return toUserDto(user);
  } catch (err) {
    // Two admins creating the same email at once: the unique index decides.
    if ((err as { code?: number }).code === 11000) {
      throw AppError.conflict('A user with this email already exists');
    }
    throw err;
  }
}

/**
 * Updates name, role or active status. Admins cannot demote or deactivate themselves, and the
 * last active admin can never be removed, so the shop can never be locked out.
 */
export async function updateUser(
  actorId: string,
  id: string,
  input: UpdateUserInput,
): Promise<UserDto> {
  const user = await findUserOr404(id);
  const isSelf = String(user._id) === actorId;
  const losesAdmin =
    user.role === 'admin' &&
    user.isActive &&
    ((input.role !== undefined && input.role !== 'admin') || input.isActive === false);

  if (
    isSelf &&
    (input.isActive === false || (input.role !== undefined && input.role !== user.role))
  ) {
    throw AppError.badRequest('You cannot change your own role or deactivate your own account');
  }
  if (losesAdmin) {
    const otherAdmins = await UserModel.countDocuments({
      role: 'admin',
      isActive: true,
      _id: { $ne: user._id },
    });
    if (otherAdmins === 0)
      throw AppError.conflict('There must always be at least one active admin');
  }

  const deactivated = user.isActive && input.isActive === false;
  user.set(input);
  await user.save();
  if (deactivated) await revokeUserSessions(user._id, 'admin');
  return toUserDto(user);
}

/** Sets a new password for a user (e.g. a cashier who forgot theirs) and signs them out everywhere. */
export async function resetPassword(id: string, password: string): Promise<UserDto> {
  const user = await findUserOr404(id);
  user.passwordHash = await hashPassword(password);
  await user.save();
  await revokeUserSessions(user._id, 'admin');
  return toUserDto(user);
}
