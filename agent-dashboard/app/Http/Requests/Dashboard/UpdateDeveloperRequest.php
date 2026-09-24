<?php

namespace App\Http\Requests\Dashboard;

use App\Enums\DeveloperStatus;
use App\Models\Developer;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateDeveloperRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('manageAgents') ?? false;
    }

    /**
     * Deactivation is `status=inactive`; developers are never deleted from the dashboard.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        /** @var Developer $developer */
        $developer = $this->route('developer');

        return [
            'name' => ['required', 'string', 'max:120'],
            'email' => ['required', 'string', 'email', 'max:191', Rule::unique('developers', 'email')->ignore($developer->id)],
            'team' => ['nullable', 'string', 'max:120'],
            'status' => ['required', Rule::enum(DeveloperStatus::class)],
        ];
    }
}
