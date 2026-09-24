<?php

namespace App\Actions\Ingestion\Exceptions;

use RuntimeException;

/**
 * The batch transaction rolled back. The failure has already been recorded on the batch and sync state.
 */
class PersistenceFailedException extends RuntimeException {}
