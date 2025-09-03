// Initialize Supabase client 
const supabase = createClient('https://zjxsymoobzgtxurwdxsl.supabase.co', 'your-anon-key');

// Get the buttons and dropdowns
const categoryButton = document.getElementById('chooseCategoryBtn');
const verifierButton = document.getElementById('chooseVerifierBtn');

const categoryDropdown = document.getElementById('categoryDropdown');
const verifierDropdown = document.getElementById('verifierDropdown');

// Handle Category Button Click
categoryButton.addEventListener('click', async () => {
    // Toggle visibility of the category dropdown
    categoryDropdown.style.display = categoryDropdown.style.display === 'block' ? 'none' : 'block';

    // Fetch categories from Supabase
    const { data: categories, error: categoryError } = await supabase
        .from('Categories')
        .select('*');  // Ensure we're selecting all categories

    if (categoryError) {
        console.error('Error fetching categories:', categoryError);
    } else {
        // Clear the existing category dropdown before populating
        categoryDropdown.innerHTML = '';

        // Populate the category dropdown with all categories
        categories.forEach(category => {
            const option = document.createElement('p');
            option.textContent = category.name;  // Assuming 'name' is the field in your Categories table
            option.addEventListener('click', () => {
                // Set the category as the selected category
                categoryDropdown.style.display = 'none';  // Hide dropdown after selection
                categoryButton.textContent = `Category: ${category.name}`;  // Update button text
            });
            categoryDropdown.appendChild(option);
        });
    }
});

// Handle Verifier Button Click
verifierButton.addEventListener('click', async () => {
    // Toggle visibility of the verifier dropdown
    verifierDropdown.style.display = verifierDropdown.style.display === 'block' ? 'none' : 'block';

    // Get selected category
    const selectedCategory = categoryButton.textContent.replace('Category: ', '').trim();

    if (!selectedCategory) {
        alert('Please select a category first');
        return;
    }

    // Fetch verifiers from Supabase based on the selected category
    const { data: verifiers, error: verifierError } = await supabase
        .from('Verifiers')
        .select('*')
        .eq('category', selectedCategory);  // Filter verifiers by the selected category

    if (verifierError) {
        console.error('Error fetching verifiers:', verifierError);
    } else {
        // Clear the existing verifier dropdown before populating
        verifierDropdown.innerHTML = '';

        // Populate the verifier dropdown with verifiers for the selected category
        verifiers.forEach(verifier => {
            const option = document.createElement('p');
            option.textContent = verifier.name;  // Assuming 'name' is the field in your Verifiers table
            option.addEventListener('click', () => {
                // Set the verifier as the selected verifier
                verifierDropdown.style.display = 'none';  // Hide dropdown after selection
                verifierButton.textContent = `Verifier: ${verifier.name}`;  // Update button text
            });
            verifierDropdown.appendChild(option);
        });
    }
});

// Handle Submit Button Click
document.querySelector('.submit-btn').addEventListener('click', async () => {
    const taskDescription = document.querySelector('.task-input').value;
    const selectedCategory = categoryButton.textContent.replace('Category: ', '').trim();
    const selectedVerifier = verifierButton.textContent.replace('Verifier: ', '').trim();

    if (!taskDescription || !selectedCategory || !selectedVerifier) {
        alert('Please fill out all fields before submitting.');
        return;
    }

    // Insert the task into the Supabase Tasks table
    const { data, error } = await supabase
        .from('Tasks')
        .insert([{ task_description: taskDescription, category: selectedCategory, verifier: selectedVerifier }]);

    if (error) {
        console.error('Error inserting task:', error);
    } else {
        console.log('Task successfully inserted:', data);
        alert('Task submitted successfully!');
        document.querySelector('.task-input').value = ''; // Clear the task input field
    }
});
