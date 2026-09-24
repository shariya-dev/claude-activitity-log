<?php

namespace App\Http\Requests\Dashboard;

use App\Enums\UserRole;
use App\Models\User;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * One change per request: role, prompt permission, or active flag.
 */
class UpdateUserRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('manageUsers') ?? false;
    }

    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'role' => ['required_without_all:can_view_prompts,is_active', Rule::enum(UserRole::class)],
            'can_view_prompts' => ['required_without_all:role,is_active', 'boolean'],
            'is_active' => ['required_without_all:role,can_view_prompts', 'boolean'],
        ];
    }

    /**
     * Admins can't demote or deactivate themselves (the last-active-admin check runs under a lock in the controller).
     *
     * @return array<int, callable(Validator): void>
     */
    public function after(): array
    {
        return [
            function (Validator $validator): void {
                /** @var User $target */
                $target = $this->route('user');

                if ($validator->errors()->isNotEmpty() || $target->isNot($this->user())) {
                    return;
                }

                if ($this->filled('role') && $this->enum('role', UserRole::class) !== UserRole::Admin) {
                    $validator->errors()->add('role', 'You cannot change your own role.');
                }

                if ($this->has('is_active') && ! $this->boolean('is_active')) {
                    $validator->errors()->add('is_active', 'You cannot deactivate yourself.');
                }
            },
        ];
    }

    /**
     * @return array{role?: UserRole, can_view_prompts?: bool, is_active?: bool}
     */
    public function changes(): array
    {
        $changes = [];

        if ($this->filled('role')) {
            $changes['role'] = $this->enum('role', UserRole::class) ?? UserRole::Viewer;
        }

        if ($this->has('can_view_prompts')) {
            $changes['can_view_prompts'] = $this->boolean('can_view_prompts');
        }

        if ($this->has('is_active')) {
            $changes['is_active'] = $this->boolean('is_active');
        }

        return $changes;
    }
}
