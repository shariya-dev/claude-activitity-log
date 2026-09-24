<?php

namespace App\Console\Commands;

use App\Enums\UserRole;
use App\Models\User;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password;

#[Signature('monitor:create-admin {email : Email address of the new admin} {--name= : Display name (defaults to the email local part)}')]
#[Description('Create an active dashboard admin, prompting for the password')]
class CreateAdmin extends Command
{
    public function handle(): int
    {
        $email = (string) $this->argument('email');
        $name = (string) ($this->option('name') ?: Str::before($email, '@'));

        $identity = Validator::make(
            ['email' => $email, 'name' => $name],
            [
                'email' => ['required', 'string', 'email', 'max:255', 'unique:users,email'],
                'name' => ['required', 'string', 'max:255'],
            ],
        );

        if ($identity->fails()) {
            return $this->failWith($identity->errors()->all());
        }

        $password = (string) $this->secret('Password');
        $confirmation = (string) $this->secret('Confirm password');

        $secret = Validator::make(
            ['password' => $password, 'password_confirmation' => $confirmation],
            ['password' => ['required', 'string', 'confirmed', Password::min(12)]],
        );

        if ($secret->fails()) {
            return $this->failWith($secret->errors()->all());
        }

        $user = User::create([
            'name' => $name,
            'email' => $email,
            'password' => $password,
            'role' => UserRole::Admin,
            'can_view_prompts' => false,
            'is_active' => true,
        ]);

        $user->forceFill(['email_verified_at' => now()])->save();

        $this->components->info("Admin {$user->email} created.");

        return self::SUCCESS;
    }

    /**
     * @param  list<string>  $errors
     */
    private function failWith(array $errors): int
    {
        foreach ($errors as $error) {
            $this->components->error($error);
        }

        return self::FAILURE;
    }
}
