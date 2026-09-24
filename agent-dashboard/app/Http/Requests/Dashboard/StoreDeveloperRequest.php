<?php

namespace App\Http\Requests\Dashboard;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreDeveloperRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('manageAgents') ?? false;
    }

    /**
     * Email uniqueness includes soft-deleted developers: the column is unique in the database.
     *
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:120'],
            'email' => ['required', 'string', 'email', 'max:191', Rule::unique('developers', 'email')],
            'team' => ['nullable', 'string', 'max:120'],
        ];
    }
}
