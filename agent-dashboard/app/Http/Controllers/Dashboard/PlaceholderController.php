<?php

namespace App\Http\Controllers\Dashboard;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Renders the shared placeholder page for dashboard features whose
 * handover has not replaced its route file yet. The page title comes
 * from the route's `title` default.
 */
class PlaceholderController extends Controller
{
    public function __invoke(Request $request): Response
    {
        return Inertia::render('Placeholder', [
            'title' => (string) $request->route('title'),
        ]);
    }
}
