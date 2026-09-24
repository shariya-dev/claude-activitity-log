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
        Schema::create('session_messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('claude_session_id')->constrained('claude_sessions')->restrictOnDelete();
            $table->string('source_message_id', 64);
            $table->string('role', 16);
            $table->longText('content');
            $table->timestamp('recorded_at', 3);

            $table->unique(['claude_session_id', 'source_message_id'], 'session_messages_session_message_unique');
            $table->index(['claude_session_id', 'recorded_at']);
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('session_messages');
    }
};
