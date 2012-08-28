<?php 

/**
 * @file os_migrate_node_stub.inc
 */

class ModalImageNodeOSMigration extends OSMigration {
  public function __construct() {
    
    parent::__construct(); // nope!  AbstractNode assumes node->node
    $this->dependencies = array('UsersOS');
    
    $this->destination = new MigrateDestinationMedia();
    $this->description = t('Modal image node -> media migration class.');
    $this->source = new MigrateSourceSQL($this->query(), $this->sourceFields(), null, array('map_joinable' => FALSE));
    $this->map = new MigrateSQLMap($this->machineName, 
      array( 'nid' => array(
        'type' => 'int',
        'not null' => TRUE,
        'unsigned' => TRUE,
        'description' => 'D6 modal_image node ID.',
        'alias' => 'n',
        )
    ),
      MigrateDestinationMedia::getKeySchema()
    );

    $this->addSimpleMappings(array('uid', 'timestamp', 'path'));
    $this->addUnmigratedDestinations(array('destination_dir', 'destination_file', 'file_replace', 'preserve_files'), t('DNM')); //good defaults
    $this->addUnmigratedSources(array('group_nid', 'filename'), t('DNM')); //group nid is in prepare.  filename is in the full path
    
    $this->addFieldMapping('value', 'filepath');
    $this->addFieldMapping('source_dir')->defaultValue(variable_get('os_migrate_files', FALSE)); //adequate or does 2.4 need full path?
    
  }
  
  public function query() {
    $query = parent::d6_db_select('node', 'n')
      ->fields('n', array('nid', 'uid'));
    $query->condition('n.type', 'modal_image');
    
    $query->join('content_type_modal_image', 'ct', 'n.vid = ct.vid');
    $query->fields('ct');
    
    $query->join('files', 'f', 'ct.field_modal_image_fid = f.fid');
    $query->fields('f');
    
    $query->join('og_ancestry', 'og', 'n.nid = og.nid');
    $query->fields('og', array('group_nid'));
    $query->condition('og.group_nid', '0', '!=');

    /**
     * Modify the query.  Add joins and fields here.  content_type_${content_type} and its fields are already included.
     */
    
    return $query;
  }
  
  public function sourceFields() {
    return array(
      'uid' => t('Node owner\'s uid'),
      'filename' => t('Name of file'),
      'filepath' => t('Path to file'),
      'timestamp' => t('File creation timestamp'),
      'path' => t('URL alias'),
      );
  }
  
  public function prepareRow($current_row) {
    //get path from {url_alias}
    $query = parent::d6_db_select('url_alias', 'ua')
    ->fields('ua', array('dst'))
    ->condition('ua.src', 'node/'.$current_row->nid, '=');
    $results = $query->execute()->fetchAssoc();
    $current_row->path = $results['dst'];
  }
  


  //file is saved.  add it to usage table.
  public function complete($entity, stdClass $row) {
    file_usage_add($entity, 'file', 'file', $row->group_nid);
  }
  
  //get full list of migrated 
  public function preRollback() {
    parent::preRollback();

    $query = db_query('SELECT destid1 FROM migrate_map_modalimagenodeos');
    $fids = $query->fetchCol('destid1');
    
    variable_set('os_migrate_modalimage_prerollback', serialize($fids));  
  }
  
  //remove rolled back files from the usage table
  public function postRollback() {
    parent::postRollback();
  
    $query = db_query('SELECT destid1 FROM migrate_map_modalimagenodeos');
    $remaining_fids = $query->fetchCol('destid1');
    
    $pre_fids = variable_get('os_migrate_modalimage_prerollback', FALSE);
    variable_del('os_migrate_modalimage_prerollback');
    
    if ($pre_fids) {
      $pre_fids = unserialize($pre_fids);
    
      $deleted_fids = array_diff($pre_fids, $remaining_fids);
      foreach ($deleted_fids as $fid) {
        $file = (object) array('fid' => $fid);
        file_usage_delete($file, 'file', 'file');
      }
    }
  }
}