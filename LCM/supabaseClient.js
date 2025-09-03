import { createClient } from '@supabase/supabase-js';

// Replace with your Supabase URL and Anon Key
const supabaseUrl = 'https://your-project.supabase.co';  // Your Supabase URL
const supabaseKey = 'your-anon-key'; // Your Supabase Anon Key
const supabase = createClient(supabaseUrl, supabaseKey);

export default supabase;
