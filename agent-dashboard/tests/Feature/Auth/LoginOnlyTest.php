<?php

use App\Models\User;
use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Route;
use Inertia\Testing\AssertableInertia as Assert;

uses(RefreshDatabase::class);

test('removed authentication routes are not found', function (string $method, string $uri) {
    $this->call($method, $uri)->assertNotFound();
})->with([
    'register form' => ['GET', '/register'],
    'register submit' => ['POST', '/register'],
    'forgot password form' => ['GET', '/forgot-password'],
    'forgot password submit' => ['POST', '/forgot-password'],
    'reset password form' => ['GET', '/reset-password/some-token'],
    'reset password submit' => ['POST', '/reset-password'],
    'email verification notice' => ['GET', '/email/verify'],
    'email verification link' => ['GET', '/email/verify/1/hash'],
    'email verification resend' => ['POST', '/email/verification-notification'],
    'two factor challenge form' => ['GET', '/two-factor-challenge'],
    'two factor challenge submit' => ['POST', '/two-factor-challenge'],
    'two factor enable' => ['POST', '/user/two-factor-authentication'],
    'two factor qr code' => ['GET', '/user/two-factor-qr-code'],
    'passkey login options' => ['GET', '/passkeys/login/options'],
    'passkey login' => ['POST', '/passkeys/login'],
    'passkey registration options' => ['GET', '/user/passkeys/options'],
    'passkey well-known endpoints' => ['GET', '/.well-known/passkey-endpoints'],
]);

test('removed authentication route names are not registered', function (string $name) {
    expect(Route::has($name))->toBeFalse();
})->with([
    'register', 'register.store', 'password.request', 'password.reset', 'password.email', 'password.update',
    'verification.notice', 'verification.verify', 'verification.send',
    'two-factor.login', 'two-factor.enable', 'passkey.login', 'passkey.login-options', 'passkey.store',
    'well-known.passkeys',
]);

test('guests visiting the root are redirected to the login page', function () {
    $this->get('/')->assertRedirect(route('login'));
});

test('authenticated users visiting the root are redirected to the dashboard', function () {
    $this->actingAs(User::factory()->create())
        ->get('/')
        ->assertRedirect(route('dashboard'));
});

test('a successful login lands on the dashboard', function () {
    $user = User::factory()->create();

    $this->post(route('login.store'), ['email' => $user->email, 'password' => 'password'])
        ->assertRedirect(route('dashboard', absolute: false));

    $this->assertAuthenticatedAs($user);
});

test('a user without a verified email can log in and reach the dashboard', function () {
    $user = User::factory()->unverified()->create();

    $this->post(route('login.store'), ['email' => $user->email, 'password' => 'password'])
        ->assertRedirect(route('dashboard', absolute: false));

    $this->assertAuthenticatedAs($user);
    $this->get(route('dashboard'))->assertOk();
});

test('a user without a verified email can reach the settings pages', function () {
    $user = User::factory()->unverified()->create();

    $this->actingAs($user)->get(route('profile.edit'))->assertOk();
    $this->actingAs($user)->get(route('security.edit'))->assertOk();
    $this->actingAs($user)->get(route('appearance.edit'))->assertOk();
});

test('the user model no longer requires email verification', function () {
    expect(new User)->not->toBeInstanceOf(MustVerifyEmail::class);
});

test('an inactive user who logs in is still logged out before reaching the dashboard', function () {
    $user = User::factory()->create(['is_active' => false]);

    $this->post(route('login.store'), ['email' => $user->email, 'password' => 'password'])
        ->assertRedirect(route('dashboard', absolute: false));

    $this->get(route('dashboard'))
        ->assertRedirect(route('login'))
        ->assertSessionHas('status', 'Your account has been deactivated.');

    $this->assertGuest();
});

test('the login page offers email and password login only', function () {
    $this->get(route('login'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('auth/Login')
            ->missing('canResetPassword'));

    $source = (string) file_get_contents(resource_path('js/pages/auth/Login.vue'));

    expect($source)
        ->not->toContain('register')
        ->not->toContain('Sign up')
        ->not->toContain('Forgot')
        ->not->toContain('routes/password')
        ->not->toContain('Passkey');
});

test('the removed authentication pages and components are gone', function (string $path) {
    expect(resource_path("js/{$path}"))->not->toBeFile();
})->with([
    'pages/auth/Register.vue',
    'pages/auth/ForgotPassword.vue',
    'pages/auth/ResetPassword.vue',
    'pages/auth/VerifyEmail.vue',
    'pages/auth/TwoFactorChallenge.vue',
    'pages/Welcome.vue',
    'components/PasskeyVerify.vue',
    'components/PasskeyRegister.vue',
    'components/PasskeyItem.vue',
    'components/ManagePasskeys.vue',
    'components/ManageTwoFactor.vue',
    'components/TwoFactorSetupModal.vue',
    'components/TwoFactorRecoveryCodes.vue',
]);
