<?php

use Illuminate\Support\Facades\Route;

function withProbeRouteFile(string $directory, string $routeName, Closure $assertions): void
{
    $path = base_path("routes/{$directory}/zz-route-loading-probe.php");

    file_put_contents($path, <<<PHP
    <?php

    use Illuminate\Support\Facades\Route;

    Route::get('route-loading-probe', fn () => 'ok')->name('{$routeName}');

    PHP);

    try {
        test()->refreshApplication();
        $assertions(Route::getRoutes()->getByName($routeName));
    } finally {
        unlink($path);
    }
}

test('agent route files are loaded under the api/agent/v1 prefix with api middleware', function () {
    withProbeRouteFile('agent', 'probe.agent', function ($route) {
        expect($route)->not->toBeNull()
            ->and($route->uri())->toBe('api/agent/v1/route-loading-probe')
            ->and($route->gatherMiddleware())->toContain('api')
            ->not->toContain('web');
    });
});

test('dashboard route files are loaded with web, auth and active middleware', function () {
    withProbeRouteFile('dashboard', 'probe.dashboard', function ($route) {
        expect($route)->not->toBeNull()
            ->and($route->uri())->toBe('route-loading-probe')
            ->and($route->gatherMiddleware())->toContain('web', 'auth', 'active')
            ->not->toContain('verified');
    });
});

test('the dashboard route is served from the dashboard route files', function () {
    $route = Route::getRoutes()->getByName('dashboard');

    expect($route)->not->toBeNull()
        ->and($route->uri())->toBe('dashboard')
        ->and($route->gatherMiddleware())->toContain('web', 'auth', 'active')
        ->not->toContain('verified');
});

test('there is no api.php route file', function () {
    expect(base_path('routes/api.php'))->not->toBeFile();
});
