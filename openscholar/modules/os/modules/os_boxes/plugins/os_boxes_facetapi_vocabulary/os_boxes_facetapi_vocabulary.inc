<?php
class os_boxes_facetapi_vocabulary extends os_boxes_default {

  /**
   * Create a new box.
   */
  protected function __construct() {
    parent::__construct();
    $this->title = t('Filter by taxonomy');
  }

  /**
   * Implementation of boxes_content::options_defaults().
   */
  public function options_defaults() {
    $options = parent::options_defaults();
    $options['vocabularies'] = $this->get_all_vocabularies();

    return $options;
  }

  /**
   * Implementation of boxes_content::options_form().
   */
  public function options_form(&$form_state) {
    ctools_include('taxonomy', 'os');
    $form = parent::options_form($form_state);

    $form['vocabularies'] = array(
      '#type' => 'checkboxes',
      '#title' => t('Vocabularies'),
      '#description' => t('Select which vocabularies to show. No selection will show all vocabularies.'),
      '#options' => $this->get_all_vocabularies(),
      '#default_value' => $this->options['vocabularies'],
    );
    return $form;
  }

  /**
   * Implementation of boxes_content::render().
   */
  public function render() {
    $block = parent::render();

    $searcher_name = os_search_solr_get_searcher_name();
    // Gets delta map
    if (!$map = facetapi_get_delta_map()) {
      return $block;
    }

    // Filter by OG vocab.
    $string_og_vocab = facetapi_build_delta($searcher_name, 'block', 'sm_og_vocabulary');
    $delta_og_vocab = array_search($string_og_vocab, $map);

    $delta = $block['delta'];
    $block = module_invoke('facetapi', 'block_view', $delta_og_vocab);
    $block['delta'] = $delta;

    // Set block subject/title from box configuration.
    $block['subject'] = $this->title;
    $block['title'] = $this->title;

    if (!empty($block['content'])) {
      // Get the list of selected vocabularies
      $selected = array();
      foreach ($this->options['vocabularies'] as $vocabulary_name => $value) {
        if ($value) {
          $selected[$vocabulary_name] = $value;
        }
      }
      // If no selection - show all. If there is selection - show only them.
      if (count($selected) > 0) {
        foreach (array_keys($block['content']['sm_og_vocabulary']) as $vocabulary_name) {
          if (empty($selected[$vocabulary_name])) {
            unset($block['content']['sm_og_vocabulary'][$vocabulary_name]);
          }
        }
      }
      $block['content'] = render($block['content']);
    }
    return $block;
  }

  /**
   * Get all the vocabularies id using the taxonomy terms.
   */
  private function get_all_vocabularies() {

    ctools_include('taxonomy', 'os');
    $taxonomy_vocabularies = os_get_vocabularies();
    $vocabularies = array();

    foreach ($taxonomy_vocabularies as $taxonomy_vocabulary) {
      $vocabularies[$taxonomy_vocabulary->machine_name] = $taxonomy_vocabulary->name;
    }

    return $vocabularies;
  }
}