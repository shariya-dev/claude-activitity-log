<?php

use App\Actions\Agent\Support\AgentError;
use App\Http\Middleware\AttachSettingsVersion;
use App\Http\Middleware\EnsureDeviceIsActive;
use App\Http\Middleware\EnsureUserIsActive;
use App\Http\Middleware\HandleAppearance;
use App\Http\Middleware\HandleInertiaRequests;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Exceptions\ThrottleRequestsException;
use Illuminate\Http\Middleware\AddLinkHeadersForPreloadedAssets;
use Illuminate\Http\Middleware\TrustProxies;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
        then: function (): void {
            Route::prefix('api/agent/v1')
                ->middleware('api')
                ->group(glob(base_path('routes/agent/*.php')) ?: []);

            Route::middleware(['web', 'auth', 'verified', 'active'])
                ->group(glob(base_path('routes/dashboard/*.php')) ?: []);
        },
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->encryptCookies(except: ['appearance', 'sidebar_state']);

        $middleware->web(append: [
            HandleAppearance::class,
            HandleInertiaRequests::class,
            AddLinkHeadersForPreloadedAssets::class,
        ]);

        $middleware->alias([
            'device.active' => EnsureDeviceIsActive::class,
            'settings.version' => AttachSettingsVersion::class,
            'active' => EnsureUserIsActive::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );

        // Agent API failures Laravel renders itself use the contract error envelope (sync-api-v1 §9).
        // Fixed messages only: exception text never reaches the agent. Dashboard (web) rendering is untouched.
        $exceptions->render(function (Throwable $e, Request $request) {
            if (! $request->is('api/agent/*')) {
                return null;
            }

            if ($e instanceof AuthenticationException) {
                return AgentError::make('unauthenticated', 'The device token is missing, invalid or revoked. Pair this device again.', 401);
            }

            if ($e instanceof ThrottleRequestsException) {
                return AgentError::make('rate_limited', 'Too many requests. Retry after the time given in the Retry-After header.', 429)
                    ->withHeaders($e->getHeaders());
            }

            if ($e instanceof ValidationException || $e instanceof HttpResponseException) {
                return null;
            }

            $status = $e instanceof HttpExceptionInterface ? $e->getStatusCode() : 500;

            return $status >= 500
                ? AgentError::make('persistence_failed', 'The batch could not be stored. Retry later.', 500)
                : null;
        });
    })
    ->booted(function (): void {
        // MONITOR_TRUSTED_PROXIES: comma list or `*`; empty trusts no proxy, so X-Forwarded-For is ignored.
        // Set here rather than in withMiddleware(), which runs before the configuration is loaded.
        $proxies = trim((string) config('monitor.trusted_proxies', ''));
        TrustProxies::at($proxies === '' ? [] : $proxies);
    })->create();
