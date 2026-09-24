<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('agent_sync_states', function (Blueprint $table) {
            $table->id();
            $table->foreignId('device_id')->unique()->constrained('devices')->restrictOnDelete();
            $table->string('cursor', 255)->nullable();
            $table->unsignedBigInteger('sequence')->default(0);
            $table->char('last_batch_uuid', 36)->nullable();
            $table->timestamp('last_success_at')->nullable();
            $table->timestamp('last_failure_at')->nullable();
            $table->string('last_error_code', 64)->nullable();
            $table->text('last_error_message')->nullable();
            $table->unsignedInteger('consecutive_failures')->default(0);
            $table->unsignedBigInteger('records_created_total')->default(0);
            $table->unsignedBigInteger('records_updated_total')->default(0);
            $table->unsignedBigInteger('records_rejected_total')->default(0);
            $table->string('health', 16)->default('healthy');
            $table->timestamps();

            $table->index('health');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('agent_sync_states');
    }
};
